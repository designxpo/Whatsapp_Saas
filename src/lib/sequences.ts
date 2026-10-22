import { db } from "./supabase";
import { accountCanSend } from "./feature-guard";
import { assertTextsAllowed } from "./moderation";
import { markNumberNotOnWhatsApp, recordSequenceSend, countAutomatedSends } from "./dripstore";
import { DEFAULT_TENANT_ID } from "./tenant";
// Sequences (drip) — timed, multi-step automations. The backbone for follow-up
// nurture AND cart recovery AND post-purchase. Enrollment is created by any
// event (keyword, opt-in, story_reply, tag, cart_abandoned…); the cron advances
// due enrollments through the steps.
//
// Compliance: Instagram steps only send inside the 24h window (instagram.ts
// enforces it). WhatsApp steps outside the window must use an approved template
// (action.type = 'template'); session text/media only land inside the window.

import { tdb } from "./tenantdb";
import {
  rangeStart, isRangeKey, rangeDays, granularityFor, bucketKey, bucketKeys,
  type RangeKey, type Granularity,
} from "./analytics-range";
import { startOfDayIn } from "./businessclock";
import { pageAll } from "./pagedselect";
import { getChannel } from "./channels";
import { sendText, sendTemplateSingle, sendMedia, renderTemplateBody, WA_NOT_ON_WHATSAPP } from "./whatsapp";
import { getDailyCap } from "./quota";
import { sendIgMessage, within24hWindow } from "./instagram";
import {
  withinSendWindow, nextWindowOpening, shouldStopForReply, hasWindow,
  nextDayOpening, localDayBounds,
} from "./seqwindow";
import {
  getConversationByPhone, getOrCreateConversation, getContactByPhoneLoose,
  appendConvMessage, touchOutbound,
  dailySentCount, isOptedOutStrict,
} from "./store";
import { matchesAudience, parseAudience, describeAudience, type AudienceRule } from "./seqaudience";
import { resolveCannedParams } from "./canned";
import { leadTokens, missingTokens } from "./leadtokens";
import { leadLane, laneAllows, isLane, isAidaStage, type Lane, type AidaStage } from "./lanes";
import { toWaNumber } from "./leadwelcome";

export type SequenceTriggerKind =
  | "manual" | "keyword" | "tag_added" | "opt_in" | "story_reply"
  | "comment" | "cart_abandoned" | "order_placed" | "ad_referral" | "inactivity";

export interface SequenceStepAction {
  type: "text" | "template" | "media";
  text?: string;
  templateName?: string; languageCode?: string; params?: string[];
  mediaKind?: "image" | "video" | "document" | "audio"; url?: string; caption?: string;
}
export interface SequenceStep {
  id: string; stepIndex: number; delayMinutes: number; action: SequenceStepAction;
  // 0103. Who this step is for. Null = everyone, which is every step that
  // existed before. A lead who does not match is SKIPPED and the journey
  // advances — see seqaudience.ts for why a miss is not a stop.
  audience: AudienceRule | null;
}
export interface Sequence {
  tenantId: string;
  id: string; name: string; channelId: string | null;
  platform: "whatsapp" | "instagram"; triggerKind: SequenceTriggerKind;
  triggerValue: string | null; active: boolean;
  // 0100. Null means unfiled — the journey predates the lanes and no lane
  // check is applied to it, so shipping this could not switch off a working
  // automation.
  team: Lane | null;
  aidaStage: AidaStage | null;
  // 0101. Stop the journey the moment the lead replies, taps a button, or a
  // human takes the conversation. Defaults true — a nurture that talks over a
  // live conversation is the worst thing this engine can do.
  stopOnReply: boolean;
  // 0101. Half-open local-hour window [start, end). Null/null = send at any
  // hour, which is how every sequence behaved before 0101.
  sendStartHour: number | null;
  sendEndHour: number | null;
  // 0103. Refuse to enrol a lead who wrote to us in the last N days — the
  // "tapped A or B but still unreachable → skip". Null = off.
  skipIfRecentReplyDays: number | null;
  // 0103. Most automated messages this lead may get in one local day, counted
  // across every journey. Over the cap is DEFERRED, never dropped. Null = off.
  maxPerDay: number | null;
}

function mapSeq(r: Record<string, unknown>): Sequence {
  return {
    tenantId: (r.tenant_id as string) ?? DEFAULT_TENANT_ID,
    id: r.id as string, name: r.name as string, channelId: (r.channel_id as string | null) ?? null,
    platform: (r.platform as Sequence["platform"]) ?? "whatsapp",
    triggerKind: (r.trigger_kind as SequenceTriggerKind) ?? "manual",
    triggerValue: (r.trigger_value as string | null) ?? null, active: (r.active as boolean) ?? true,
    // Narrowed rather than cast: the column accepts ops and api for consistency
    // with 0073, and neither runs a funnel, so they read here as unfiled.
    team: isLane(r.team) ? r.team : null,
    aidaStage: isAidaStage(r.aida_stage) ? r.aida_stage : null,
    // Absent column (0101 not applied yet) reads as the pre-0101 behaviour:
    // inactivity-only stopping, and no send window. `!== false` rather than a
    // truthiness check so an explicit false survives and a missing column does
    // not silently disable the rule everything now depends on.
    stopOnReply: (r.stop_on_reply as boolean | undefined) !== false,
    sendStartHour: typeof r.send_start_hour === "number" ? r.send_start_hour : null,
    sendEndHour: typeof r.send_end_hour === "number" ? r.send_end_hour : null,
    // Absent columns (0103 not applied) read as off, so nothing starts
    // refusing enrolments or deferring steps because a deploy arrived first.
    skipIfRecentReplyDays: typeof r.skip_if_recent_reply_days === "number" ? r.skip_if_recent_reply_days : null,
    maxPerDay: typeof r.max_per_day === "number" ? r.max_per_day : null,
  };
}

// ── CRUD ──────────────────────────────────────────────────────────────────────
export async function listSequences(tenantId = DEFAULT_TENANT_ID): Promise<Sequence[]> {
  const { data } = await tdb(tenantId).from("wa_sequences").select("*").order("created_at", { ascending: false });
  return (data ?? []).map(r => mapSeq(r as unknown as Record<string, unknown>));
}

export async function getSequence(id: string, tenantId = DEFAULT_TENANT_ID): Promise<Sequence | null> {
  const { data } = await tdb(tenantId).from("wa_sequences").select("*").eq("id", id).maybeSingle();
  return data ? mapSeq(data as unknown as Record<string, unknown>) : null;
}

// A deploy can land before its migration does — 0092 onwards are still
// pending as this ships. Writing a column that does not exist yet fails the
// whole statement, so saving ANY sequence would break until somebody ran 0100.
// Same ladder as team.ts uses for reads, for the same reason: drop the newest
// columns and try again, because the absent ones are always the newest.
const missingColumn = (e: { code?: string } | null | undefined): boolean =>
  e?.code === "42703" || e?.code === "PGRST204";

export async function createSequence(p: { name: string; channelId?: string | null; platform?: "whatsapp" | "instagram"; triggerKind?: SequenceTriggerKind; triggerValue?: string | null; team?: Lane | null; aidaStage?: AidaStage | null; stopOnReply?: boolean; sendStartHour?: number | null; sendEndHour?: number | null; skipIfRecentReplyDays?: number | null; maxPerDay?: number | null }, tenantId = DEFAULT_TENANT_ID): Promise<Sequence> {
  const base = {
    name: p.name.trim(), channel_id: p.channelId ?? null, platform: p.platform ?? "whatsapp",
    trigger_kind: p.triggerKind ?? "manual", trigger_value: p.triggerValue ?? null,
  };
  const withLanes = { ...base, team: p.team ?? null, aida_stage: p.aidaStage ?? null };
  const withRules = {
    ...withLanes,
    stop_on_reply: p.stopOnReply ?? true,
    send_start_hour: p.sendStartHour ?? null,
    send_end_hour: p.sendEndHour ?? null,
  };

  const withLimits = {
    ...withRules,
    skip_if_recent_reply_days: p.skipIfRecentReplyDays ?? null,
    max_per_day: p.maxPerDay ?? null,
  };

  // Newest columns first, then shed them one migration at a time. 0101 can
  // land before 0100 is applied, so the rungs are independent rather than
  // nested assumptions about which migration ran.
  let { data, error } = await tdb(tenantId).from("wa_sequences").insert(withLimits).select().single();
  if (missingColumn(error)) {
    ({ data, error } = await tdb(tenantId).from("wa_sequences").insert(withRules).select().single());
  }
  if (missingColumn(error)) {
    ({ data, error } = await tdb(tenantId).from("wa_sequences").insert(withLanes).select().single());
  }
  if (missingColumn(error)) {
    // 0100 not applied either. The journey is created unfiled, which is exactly
    // how every sequence behaved before the lanes existed.
    ({ data, error } = await tdb(tenantId).from("wa_sequences").insert(base).select().single());
  }
  if (error) throw error;
  return mapSeq(data as unknown as Record<string, unknown>);
}

export async function updateSequence(id: string, p: Partial<{ name: string; channelId: string | null; platform: "whatsapp" | "instagram"; triggerKind: SequenceTriggerKind; triggerValue: string | null; active: boolean; team: Lane | null; aidaStage: AidaStage | null; stopOnReply: boolean; sendStartHour: number | null; sendEndHour: number | null; skipIfRecentReplyDays: number | null; maxPerDay: number | null }>, tenantId = DEFAULT_TENANT_ID): Promise<void> {
  const row: Record<string, unknown> = {};
  if (p.name !== undefined) row.name = p.name.trim();
  if (p.channelId !== undefined) row.channel_id = p.channelId;
  if (p.platform !== undefined) row.platform = p.platform;
  if (p.triggerKind !== undefined) row.trigger_kind = p.triggerKind;
  if (p.triggerValue !== undefined) row.trigger_value = p.triggerValue;
  if (p.active !== undefined) row.active = p.active;
  if (p.team !== undefined) row.team = p.team;
  if (p.aidaStage !== undefined) row.aida_stage = p.aidaStage;
  if (p.stopOnReply !== undefined) row.stop_on_reply = p.stopOnReply;
  if (p.sendStartHour !== undefined) row.send_start_hour = p.sendStartHour;
  if (p.sendEndHour !== undefined) row.send_end_hour = p.sendEndHour;
  if (p.skipIfRecentReplyDays !== undefined) row.skip_if_recent_reply_days = p.skipIfRecentReplyDays;
  if (p.maxPerDay !== undefined) row.max_per_day = p.maxPerDay;
  if (!Object.keys(row).length) return;
  let { error } = await tdb(tenantId).from("wa_sequences").update(row).eq("id", id);
  if (missingColumn(error)) {
    // Shed one migration's columns at a time, newest first.
    //
    // A rung is only worth attempting when shedding actually REMOVED
    // something. Retrying an identical payload fails identically, and an edit
    // that carried only a lane would otherwise pay for the same rejected write
    // twice before reaching the rung that helps.
    const { skip_if_recent_reply_days: _k, max_per_day: _m, ...r0 } = row;
    if (!Object.keys(r0).length) return;                  // nothing left to save
    if (Object.keys(r0).length < Object.keys(row).length) {
      ({ error } = await tdb(tenantId).from("wa_sequences").update(r0).eq("id", id));
    }
    if (missingColumn(error)) {
    const { stop_on_reply: _s, send_start_hour: _ss, send_end_hour: _se, ...r1 } = r0;
    if (!Object.keys(r1).length) return;                  // nothing left to save
    if (Object.keys(r1).length < Object.keys(r0).length) {
      ({ error } = await tdb(tenantId).from("wa_sequences").update(r1).eq("id", id));
    }
    if (missingColumn(error)) {
      // 0100 not applied either.
      const { team: _t, aida_stage: _a, ...rest } = r1;
      if (!Object.keys(rest).length) return;
      if (Object.keys(rest).length < Object.keys(r1).length) {
        ({ error } = await tdb(tenantId).from("wa_sequences").update(rest).eq("id", id));
      }
    }
    }
  }
  if (error) throw error;
}

export async function deleteSequence(id: string, tenantId = DEFAULT_TENANT_ID): Promise<void> {
  await tdb(tenantId).from("wa_sequences").delete().eq("id", id);   // steps + enrollments cascade
}

export async function setSequenceSteps(sequenceId: string, steps: { delayMinutes: number; action: SequenceStepAction; audience?: AudienceRule | null }[], tenantId = DEFAULT_TENANT_ID): Promise<void> {
  if (!await getSequence(sequenceId, tenantId)) throw new Error("Sequence not found");
  await assertTextsAllowed(steps.flatMap(s => [s.action.text, s.action.caption]), { tenantId, surface: "sequence_text" });
  await tdb(tenantId).from("wa_sequence_steps").delete().eq("sequence_id", sequenceId);
  if (!steps.length) return;
  const base = steps.map((s, i) => ({ sequence_id: sequenceId, step_index: i, delay_minutes: Math.max(0, Math.round(s.delayMinutes)), action: s.action }));
  const rows = base.map((r, i) => ({ ...r, audience: steps[i].audience ?? null }));
  let { error } = await tdb(tenantId).from("wa_sequence_steps").insert(rows);
  // 0103 not applied yet. Losing the audience rule would send a step to
  // EVERYONE, so the steps are still saved (an editor that cannot save is
  // worse) but the caller is told, loudly, rather than silently widened.
  if (missingColumn(error)) {
    ({ error } = await tdb(tenantId).from("wa_sequence_steps").insert(base));
    if (!error && steps.some(s => s.audience)) {
      console.error(JSON.stringify({
        tag: "sequence_audience_dropped", sequenceId,
        detail: "0103 is not applied — per-step audience rules were NOT saved and these steps will go to everyone.",
      }));
    }
  }
  if (error) throw error;
}

export async function getSequenceSteps(sequenceId: string, tenantId = DEFAULT_TENANT_ID): Promise<SequenceStep[]> {
  const { data } = await tdb(tenantId).from("wa_sequence_steps").select("*").eq("sequence_id", sequenceId).order("step_index");
  return ((data ?? []) as unknown as Record<string, unknown>[]).map(r => ({
    id: r.id as string, stepIndex: r.step_index as number, delayMinutes: (r.delay_minutes as number) ?? 0,
    action: (r.action as SequenceStepAction) ?? { type: "text" },
    audience: parseAudience(r.audience),
  }));
}

// Resolve the active sequence bound to an event (keyword/story_reply/etc).
export async function getSequenceByTrigger(kind: SequenceTriggerKind, value?: string | null, tenantId = DEFAULT_TENANT_ID): Promise<Sequence | null> {
  let q = tdb(tenantId).from("wa_sequences").select("*").eq("trigger_kind", kind).eq("active", true);
  if (value) q = q.eq("trigger_value", value);
  const { data } = await q.order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data ? mapSeq(data as unknown as Record<string, unknown>) : null;
}

// Match an active keyword-triggered sequence to inbound text (case-insensitive,
// trimmed, platform-scoped). The inbound webhooks call this: when a contact
// sends the exact trigger word we enroll them and let the drip drive the chat.
export async function matchKeywordSequence(platform: "whatsapp" | "instagram", text: string, tenantId = DEFAULT_TENANT_ID): Promise<Sequence | null> {
  const v = (text ?? "").trim().toLowerCase();
  if (!v) return null;
  const { data } = await tdb(tenantId).from("wa_sequences").select("*")
    .eq("trigger_kind", "keyword").eq("active", true).eq("platform", platform)
    .order("created_at", { ascending: false });
  const row = ((data ?? []) as unknown as Record<string, unknown>[]).find(r => ((r.trigger_value as string) ?? "").trim().toLowerCase() === v);
  return row ? mapSeq(row as unknown as Record<string, unknown>) : null;
}

// ── Enrollment ──────────────────────────────────────────────────────────────
export interface EnrolResult { enrolled: boolean; reason?: string }

/**
 * Put a contact into a journey.
 *
 * Refuses when the lead is in the other lane. Marketing journeys speak to
 * strangers at scale; sales journeys speak as the counsellor who owns the
 * lead. Sending either to the other lane's audience is the mistake the whole
 * split exists to prevent, and it has to be refused HERE rather than at each
 * of the eleven places that enrol somebody — a rule enforced per call site is
 * a rule that is missing from the twelfth.
 *
 * Checked at enrolment rather than at send: a send-time check would leave the
 * enrolment in the queue quietly accumulating skipped steps, which reads on
 * the monitor as a broken sequence rather than as a lead who moved on.
 *
 * Unfiled sequences (no team) enrol anybody, so shipping the lanes could not
 * switch off an automation that was working the day before.
 */
export async function enroll(
  sequenceId: string,
  p: {
    phone: string; platform?: "whatsapp" | "instagram"; conversationId?: string | null;
    restart?: boolean;
    /**
     * Allow this journey to run alongside another. Off by default — see the
     * guard below.
     */
    allowConcurrent?: boolean;
  },tenantId = DEFAULT_TENANT_ID
): Promise<EnrolResult> {
  const steps = await getSequenceSteps(sequenceId, tenantId);
  if (!steps.length) return { enrolled: false, reason: "the sequence has no steps" };

  // ── The number is normalised HERE, for the same reason the lane guard is ──
  //
  // A bare ten-digit Indian number enrolled on 1 October and the journey
  // half-worked in the worst way: WhatsApp accepted the sends, so messages
  // arrived, but every lookup keyed on the phone missed. The drip log wrote
  // nowhere, nothing appeared in Live Chat, and the contact's own record
  // showed no trace of five messages that had just gone out.
  //
  // Nothing failed. setContactAttributes returns silently when it cannot find
  // the contact, which is right for a best-effort log and means a mistyped
  // number loses the history with no error anywhere.
  //
  // Doing it in the eleven callers is doing it in ten of them, so it happens
  // once, here. Instagram is left alone — an IGSID is a numeric id, not a
  // phone, and prefixing it with a country code would break it.
  const phone = p.platform === "instagram" ? (p.phone ?? "").trim() : toWaNumber(p.phone);
  if (!phone) return { enrolled: false, reason: "no usable number to enrol" };

  // ── Never silently restart a journey somebody already finished ──────────
  //
  // The write below is an upsert on (sequence_id, phone), so without this a
  // second enrolment resets current_step to 0 and status to active. That is
  // right for a genuinely repeatable trigger — a cart abandoned twice is two
  // abandonments — and badly wrong for a stage-driven nurture.
  //
  // LeadSquared fires a webhook on EVERY stage change and remembers no
  // earlier state. So a lead who reaches Not Reachable, gets the four-week
  // drip, is finally contacted, goes quiet again and is moved back to Not
  // Reachable would be sent the entire sequence a second time, opening with
  // "welcome to Acme" to somebody who has had it already.
  //
  // Worse: `stopped` is the status a REPLY sets. Resurrecting that row means
  // a lead who answered, was handed to a counsellor and stopped receiving
  // messages starts receiving them again the next time their stage moves —
  // which is the exact failure the reply-stop exists to prevent.
  //
  // So a finished or stopped enrolment stays finished unless the caller says
  // otherwise. `restart: true` is for triggers that genuinely recur.
  if (!p.restart) {
    const { data: prior } = await tdb(tenantId).from("wa_sequence_enrollments")
      .select("status").eq("sequence_id", sequenceId).eq("phone", phone).limit(1);
    const existing = (prior ?? [])[0] as { status?: string } | undefined;
    if (existing && existing.status !== "active") {
      return { enrolled: false, reason: `this lead has already been through "${(await getSequence(sequenceId, tenantId))?.name ?? "this journey"}" (${existing.status})` };
    }
  }

  const seq = await getSequence(sequenceId, tenantId);

  // ── One journey at a time ───────────────────────────────────────────────
  //
  // "One active sequence per lead" is a general rule, not a campaign one: two automated journeys talking to the same person at once is
  // never what anybody meant, and the lead cannot tell that the conflicting
  // messages came from different campaigns.
  //
  // Enforced HERE rather than at each of the eleven call sites, for the same
  // reason the lane guard is — a rule applied per caller is a rule the
  // twelfth caller does not have. drainInactiveLeads already checked this
  // itself; that check is now redundant rather than wrong, and harmless.
  //
  // `allowConcurrent` exists for a genuinely parallel series (an order-status
  // journey running under a nurture), but nothing sets it today.
  if (!p.allowConcurrent) {
    const { data: others } = await tdb(tenantId).from("wa_sequence_enrollments")
      .select("sequence_id").eq("phone", phone).eq("status", "active")
      .neq("sequence_id", sequenceId).limit(1);
    const other = (others ?? [])[0] as { sequence_id?: string } | undefined;
    if (other) {
      const name = (await getSequence(other.sequence_id ?? "", tenantId))?.name ?? "another journey";
      return { enrolled: false, reason: `this lead is already on "${name}" — one journey at a time` };
    }
  }

  if (seq?.team) {
    const lane = await leadLane(phone, tenantId);
    if (!laneAllows(seq.team, lane)) {
      return { enrolled: false, reason: `"${seq.name}" is a ${seq.team} journey and this lead is in the ${lane} lane` };
    }
  }

  // ── Do not start a nurture with somebody mid-conversation ───────────────
  //
  // The rule: "Already replied → skip the sequence. A person
  // chats instead." A lead who answered the counsellor's own message on day 1
  // or 2 is not silent — they are not answering the PHONE, which is a
  // different problem and not one four weeks of nurture solves.
  //
  // stop_on_reply cannot catch this: it compares an inbound against the
  // enrolment's own updated_at, so a reply that happened BEFORE the journey
  // began is invisible to it. This is the same rule, looking backwards.
  //
  // Days rather than a boolean because "has this lead ever written to us" is
  // the wrong question — an enquiry four months ago is not a conversation.
  if (seq?.skipIfRecentReplyDays) {
    const conv = await getConversationByPhone(phone, tenantId).catch(() => null);
    const li = conv?.lastInboundAt ? Date.parse(conv.lastInboundAt) : NaN;
    const cutoff = Date.now() - seq.skipIfRecentReplyDays * 24 * 60 * 60_000;
    if (Number.isFinite(li) && li >= cutoff) {
      return {
        enrolled: false,
        reason: `this lead wrote to us within the last ${seq.skipIfRecentReplyDays} day${seq.skipIfRecentReplyDays === 1 ? "" : "s"} — a person should reply, not a drip`,
      };
    }
  }

  const firstDelayMs = Math.max(0, steps[0].delayMinutes) * 60_000;
  const nextRun = new Date(Date.now() + firstDelayMs).toISOString();
  await tdb(tenantId).from("wa_sequence_enrollments").upsert({
    sequence_id: sequenceId, phone, platform: p.platform ?? "whatsapp",
    conversation_id: p.conversationId ?? null, current_step: 0, status: "active",
    next_run_at: nextRun, updated_at: new Date().toISOString(),
  }, { onConflict: "sequence_id,phone" });
  return { enrolled: true };
}

/**
 * Stop every MARKETING journey this contact is part-way through.
 *
 * Called when LeadSquared reports that a counsellor now owns the lead. Not a
 * handover — a stop. Somebody is talking to them personally, and a mass
 * nurture arriving alongside that conversation is what makes automation feel
 * cheap.
 *
 * Sales journeys are deliberately left running: being reassigned from one
 * counsellor to another is a change of owner, not a reason to abandon the
 * nurture the lead is already receiving.
 */
export async function stopMarketingEnrollments(phone: string, tenantId = DEFAULT_TENANT_ID): Promise<number> {
  const { data } = await tdb(tenantId).from("wa_sequences").select("id").eq("team", "marketing");
  const ids = ((data ?? []) as unknown as { id: string }[]).map(r => r.id);
  if (!ids.length) return 0;
  const { data: stopped } = await tdb(tenantId).from("wa_sequence_enrollments")
    .update({ status: "stopped", updated_at: new Date().toISOString() })
    .eq("phone", phone).eq("status", "active").in("sequence_id", ids)
    .select("id");
  return ((stopped ?? []) as unknown[]).length;
}

export async function stopEnrollment(sequenceId: string, phone: string, tenantId = DEFAULT_TENANT_ID): Promise<void> {
  await tdb(tenantId).from("wa_sequence_enrollments").update({ status: "stopped", updated_at: new Date().toISOString() })
    .eq("sequence_id", sequenceId).eq("phone", phone);
}

/**
 * Stop every ACTIVE journey this person is on, whichever sequence it belongs
 * to, and say how many there were.
 *
 * The drain loop's own reply check (stopOnReply) already stops a journey when
 * it next comes due — but "next due" can be five days away, and in the
 * meantime the portal believes the lead is still being nurtured. This is the
 * immediate version, called the moment an inbound arrives, so a counsellor
 * opening the lead sees a stopped journey rather than one that will stop
 * eventually.
 *
 * Scoped to `active` so a replayed webhook cannot resurrect and re-stop a
 * completed journey, and the returned count stays truthful on a retry: the
 * second delivery reports 0, which is exactly what happened.
 */
export async function stopAllEnrollments(phone: string, tenantId = DEFAULT_TENANT_ID): Promise<number> {
  const { data } = await tdb(tenantId).from("wa_sequence_enrollments")
    .update({ status: "stopped", updated_at: new Date().toISOString() })
    .eq("phone", phone).eq("status", "active")
    .select("id");
  return data?.length ?? 0;
}

// Is this contact currently being driven by a drip? Used to suppress the welcome
// + AI auto-reply while a sequence owns the conversation, so they don't collide
// (the drip drives until it completes/stops, then the AI resumes).
export async function hasActiveEnrollment(phone: string, tenantId = DEFAULT_TENANT_ID): Promise<boolean> {
  if (!phone) return false;
  const { data } = await tdb(tenantId).from("wa_sequence_enrollments").select("id").eq("phone", phone).eq("status", "active").limit(1);
  return (data?.length ?? 0) > 0;
}

// Like hasActiveEnrollment, but EXCLUDES inactivity re-engagement nudges. A
// returning lead who is mid-nudge must still get an immediate AI reply (the nudge
// is then stopped by the next drain via the reply guard) — only a "real" drip
// (keyword/cart/etc.) should own the thread and suppress the AI.
export async function hasActiveDripEnrollment(phone: string, tenantId = DEFAULT_TENANT_ID): Promise<boolean> {
  if (!phone) return false;
  const { data } = await tdb(tenantId).from("wa_sequence_enrollments").select("sequence_id").eq("phone", phone).eq("status", "active");
  const ids = [...new Set((data ?? []).map(r => (r as unknown as Record<string, unknown>).sequence_id as string))];
  if (!ids.length) return false;
  const { data: seqs } = await tdb(tenantId).from("wa_sequences").select("id").in("id", ids).neq("trigger_kind", "inactivity");
  return (seqs?.length ?? 0) > 0;
}

// Recent enrollments (joined with the sequence name) for the admin monitor — so
// you can SEE who's in a drip, what step they're on, when the next step fires,
// and any send error. The visibility that makes "is it working?" answerable.
export interface EnrollmentRow {
  id: string; sequenceId: string; sequenceName: string; phone: string; platform: string;
  currentStep: number; status: string; nextRunAt: string | null; lastError: string | null;
  updatedAt: string | null; createdAt: string | null;
}
/**
 * The windows the drip screens can be read over.
 *
 * One key wider than RangeKey, and that one key was a bug. The filter bar
 * offers "Today"; analytics-range does not know it, so rangeStart("today")
 * found no entry, returned null — the same answer it gives for lifetime — and
 * the screen silently showed ALL TIME while the dropdown said Today.
 *
 * "Today" is the BUSINESS day, not the UTC one. The platform runs UTC and a
 * workspace runs on its own clock, so a UTC midnight boundary would drop every
 * enrolment made before it out of "today" — for an IST workspace that is the
 * whole first half of the morning, missing from the only view that claims to
 * be live.
 */
export type DripRangeKey = RangeKey | "today";

export const DRIP_RANGES: { key: DripRangeKey; label: string }[] = [
  { key: "all",   label: "All time" },
  { key: "today", label: "Today" },
  { key: "7d",    label: "Last 7 days" },
  { key: "14d",   label: "Last 14 days" },
  { key: "30d",   label: "Last 30 days" },
  { key: "90d",   label: "Last 90 days" },
];

/** Falls back to "all" rather than throwing — but never SILENTLY, see above. */
export function parseDripRange(v: unknown): DripRangeKey {
  return v === "today" || isRangeKey(v) ? v : "all";
}

/** Start of the window, or null for lifetime. */
export function dripRangeStart(key: DripRangeKey, now = new Date()): Date | null {
  if (key === "today") return startOfDayIn(now);
  return rangeStart(key, now);
}

/** How many days the window spans, for picking a sane chart granularity. */
export function dripRangeSpanDays(key: DripRangeKey, earliest: Date | null, now = new Date()): number {
  if (key === "today") return 1;
  const days = rangeDays(key);
  if (days !== null) return days;
  if (!earliest) return 1;
  return Math.max(1, Math.ceil((now.getTime() - earliest.getTime()) / 86_400_000) + 1);
}

export interface EnrollmentFilter {
  sequenceId?: string | null;
  status?: string | null;
  platform?: string | null;
  search?: string | null;
  range?: DripRangeKey | string | null;
}

export async function listRecentEnrollments(
  limit = 50,
  tenantId = DEFAULT_TENANT_ID,
  offset = 0,
  filter?: EnrollmentFilter,
): Promise<{ data: EnrollmentRow[]; total: number }> {
  let q = tdb(tenantId).from("wa_sequence_enrollments").select("*", { count: "exact" });
  if (filter?.sequenceId && filter.sequenceId !== "all") q = q.eq("sequence_id", filter.sequenceId);
  if (filter?.status && filter.status !== "all") q = q.eq("status", filter.status);
  if (filter?.platform && filter.platform !== "all") q = q.eq("platform", filter.platform);
  if (filter?.search?.trim()) {
    const term = filter.search.trim().replace(/[%_]/g, "\\$&");
    q = q.ilike("phone", `%${term}%`);
  }
  if (filter?.range && filter.range !== "all") {
    const start = dripRangeStart(parseDripRange(filter.range));
    if (start) q = q.gte("created_at", start.toISOString());
  }

  const { data, count } = await q
    .order("updated_at", { ascending: false })
    .range(offset, offset + limit - 1);
  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  const ids = [...new Set(rows.map(r => r.sequence_id as string))];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: sd } = await tdb(tenantId).from("wa_sequences").select("id,name").in("id", ids);
    for (const s of (sd ?? []) as unknown as Record<string, unknown>[]) names.set(s.id as string, s.name as string);
  }
  return {
    total: count ?? 0,
    data: rows.map(r => ({
      id: r.id as string, sequenceId: r.sequence_id as string, sequenceName: names.get(r.sequence_id as string) ?? "—",
      phone: r.phone as string, platform: (r.platform as string) ?? "whatsapp",
      currentStep: (r.current_step as number) ?? 0, status: (r.status as string) ?? "active",
      nextRunAt: (r.next_run_at as string | null) ?? null, lastError: (r.last_error as string | null) ?? null,
      updatedAt: (r.updated_at as string | null) ?? null, createdAt: (r.created_at as string | null) ?? null,
    })),
  };
}

// ── Drip Analytics ────────────────────────────────────────────────────────────
export interface DripAnalyticsFilter {
  sequenceId?: string | null;
  range?: DripRangeKey | string | null;
  status?: string | null;
  platform?: string | null;
}

export interface DripStepMetric {
  stepIndex: number;
  stepNumber: number;
  type: string;
  templateName?: string | null;
  delayMinutes: number;
  label: string;
  currentlyOn: number;
  reachedCount: number;
  stoppedCount: number;
  failedCount: number;
  retentionRate: number;
}

export interface DripSeqAnalytics {
  id: string;
  name: string;
  platform: "whatsapp" | "instagram";
  triggerKind: string;
  triggerValue: string | null;
  active: boolean;
  team: string | null;
  aidaStage: string | null;
  totalSteps: number;
  totalEnrolled: number;
  activeCount: number;
  completedCount: number;
  stoppedCount: number;
  failedCount: number;
  completionRate: number;
  stoppedRate: number;
  failedRate: number;
  steps: DripStepMetric[];
  errors: { error: string; count: number }[];
}

export interface DripOverview {
  totalEnrolled: number;
  active: number;
  completed: number;
  stopped: number;
  failed: number;
  completionRate: number;
  stoppedRate: number;
  failedRate: number;
}

export interface DripAnalyticsSummary {
  overview: DripOverview;
  /**
   * The same five numbers BEFORE the status filter is applied — what the
   * status pills count. Without them, selecting "Failed" zeroes every other
   * pill and there is no way to read your way back out.
   */
  statusCounts: DripOverview;
  bySequence: DripSeqAnalytics[];
  dailyTrend: { date: string; enrolled: number; completed: number; stopped: number; failed: number }[];
  granularity: Granularity;
  sequences: { id: string; name: string; platform: string; active: boolean }[];
  /** True when the scan hit its cap, so the screen can say so instead of lying. */
  truncated: boolean;
  scanned: number;
  filter: {
    sequenceId: string;
    range: DripRangeKey;
    status: string;
    platform: string;
  };
}

/** Runaway guard on the analytics scan, not an expected limit. */
const DRIP_SCAN_CAP = 50_000;

/**
 * pageAll() over a tdb() builder.
 *
 * tdb() is typed against the generated schema and the drip tables are not in
 * it, so its builder reports its rows as GenericStringError[]. Every read of
 * these tables already casts for that reason — listRecentEnrollments above
 * does it too. One place to do it rather than one per call site.
 */
function pagedDripRows(
  build: () => { range(from: number, to: number): PromiseLike<unknown> },
  opts: { cap?: number; label?: string } = {},
): Promise<Record<string, unknown>[]> {
  return pageAll<Record<string, unknown>>(
    build as unknown as () => {
      range(from: number, to: number): PromiseLike<{ data: Record<string, unknown>[] | null; error: unknown }>;
    },
    opts,
  );
}

function tally(rows: Record<string, unknown>[]): DripOverview {
  let active = 0, completed = 0, stopped = 0, failed = 0;
  for (const e of rows) {
    const s = e.status as string;
    if (s === "active") active++;
    else if (s === "completed") completed++;
    else if (s === "stopped") stopped++;
    else if (s === "failed") failed++;
  }
  const total = rows.length;
  const concluded = completed + stopped + failed;
  return {
    totalEnrolled: total,
    active, completed, stopped, failed,
    completionRate: concluded > 0 ? Math.round((completed / concluded) * 100) : 0,
    stoppedRate: total > 0 ? Math.round((stopped / total) * 100) : 0,
    failedRate: total > 0 ? Math.round((failed / total) * 100) : 0,
  };
}

/**
 * Funnel and conversion numbers for the drip screens, for ONE tenant.
 *
 * Three things this has to get right:
 *
 *  • READ EVERYTHING. PostgREST hands back at most 1,000 rows per request and
 *    says nothing about the rest, so a single select would turn every figure
 *    on the page into a count of the first thousand enrolments. pageAll()
 *    pages to the end; DRIP_SCAN_CAP stops a runaway and sets `truncated` so
 *    the screen can admit it rather than quietly under-report.
 *
 *  • "REACHED" MEANS DELIVERED. current_step is the step ABOUT TO BE SENT, not
 *    the last one sent — drain() only advances it after a successful send, and
 *    leaves it alone on the final step, flipping status to completed instead.
 *    Counting `current_step >= stepIndex` would credit every lead with a step
 *    they were still waiting for, so the funnel reads 100% at every rung and
 *    shows no drop-off at all: a funnel that cannot fall is not a funnel.
 *
 *  • THE STATUS FILTER HAS TO FILTER, not just be echoed back in `filter`.
 */
export async function getDripAnalytics(
  filter: DripAnalyticsFilter = {},
  tenantId = DEFAULT_TENANT_ID,
): Promise<DripAnalyticsSummary> {
  const seqId = filter.sequenceId && filter.sequenceId !== "all" ? filter.sequenceId : "all";
  const range = parseDripRange(filter.range);
  const platform = filter.platform && filter.platform !== "all" ? filter.platform : "all";
  const statusFilter = filter.status && filter.status !== "all" ? filter.status : "all";

  const seqs = await listSequences(tenantId);

  const stepRows = await pagedDripRows(
    () => {
      let sq = tdb(tenantId).from("wa_sequence_steps").select("*");
      if (seqId !== "all") sq = sq.eq("sequence_id", seqId);
      return sq.order("sequence_id", { ascending: true }).order("step_index", { ascending: true });
    },
    { label: "drip_analytics_steps" },
  );

  const stepsBySeq = new Map<string, SequenceStep[]>();
  for (const r of stepRows) {
    const sId = r.sequence_id as string;
    if (!stepsBySeq.has(sId)) stepsBySeq.set(sId, []);
    stepsBySeq.get(sId)!.push({
      id: r.id as string,
      stepIndex: r.step_index as number,
      delayMinutes: (r.delay_minutes as number) ?? 0,
      action: (r.action as SequenceStepAction) ?? { type: "text" },
      audience: parseAudience(r.audience),
    });
  }

  const windowStart = dripRangeStart(range);
  const scanned = await pagedDripRows(
    () => {
      let q = tdb(tenantId)
        .from("wa_sequence_enrollments")
        .select("id, sequence_id, platform, current_step, status, last_error, created_at, updated_at");
      if (windowStart) q = q.gte("created_at", windowStart.toISOString());
      if (platform !== "all") q = q.eq("platform", platform);
      if (seqId !== "all") q = q.eq("sequence_id", seqId);
      // created_at alone is not a stable sort — two enrolments made in the same
      // millisecond can swap between pages, repeating one row and losing the
      // other. id breaks the tie.
      return q.order("created_at", { ascending: false }).order("id", { ascending: true });
    },
    { cap: DRIP_SCAN_CAP, label: "drip_analytics_enrollments" },
  );

  const truncated = scanned.length >= DRIP_SCAN_CAP;
  const statusCounts = tally(scanned);
  const allEnrs = statusFilter === "all"
    ? scanned
    : scanned.filter(e => (e.status as string) === statusFilter);
  const overview = tally(allEnrs);

  const targetSeqs = seqId === "all" ? seqs : seqs.filter(s => s.id === seqId);
  const bySequence: DripSeqAnalytics[] = targetSeqs
    .filter(s => platform === "all" || s.platform === platform)
    .map(s => {
      const sAllEnrs = allEnrs.filter(e => (e.sequence_id as string) === s.id);
      const t = tally(sAllEnrs);
      const errorMap = new Map<string, number>();

      for (const e of sAllEnrs) {
        if (e.last_error && typeof e.last_error === "string") {
          // One Meta blob per contact would make "top 5" a list of five
          // one-offs. Collapse the whitespace and clip, so the same failure
          // groups as the same failure.
          const key = e.last_error.replace(/\s+/g, " ").trim().slice(0, 240);
          if (key) errorMap.set(key, (errorMap.get(key) || 0) + 1);
        }
      }

      const sTotal = sAllEnrs.length;
      const steps = stepsBySeq.get(s.id) ?? [];
      const stepMetrics: DripStepMetric[] = steps.map(st => {
        let reached = 0, current = 0, stopped = 0, failed = 0;
        for (const e of sAllEnrs) {
          const cs = (e.current_step as number) ?? 0;
          const status = e.status as string;
          // Delivered: the engine moved PAST this step, or finished the
          // journey (which leaves current_step parked on the last rung).
          if (cs > st.stepIndex || status === "completed") reached++;
          if (cs === st.stepIndex) {
            if (status === "active") current++;
            else if (status === "stopped") stopped++;
            else if (status === "failed") failed++;
          }
        }
        return {
          stepIndex: st.stepIndex,
          stepNumber: st.stepIndex + 1,
          type: st.action.type,
          templateName: st.action.templateName ?? null,
          delayMinutes: st.delayMinutes,
          label: describeStep(st.action),
          currentlyOn: current,
          reachedCount: reached,
          stoppedCount: stopped,
          failedCount: failed,
          retentionRate: sTotal > 0 ? Math.round((reached / sTotal) * 100) : 0,
        };
      });

      const topErrors = Array.from(errorMap.entries())
        .map(([error, count]) => ({ error, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      return {
        id: s.id,
        name: s.name,
        platform: s.platform,
        triggerKind: s.triggerKind,
        triggerValue: s.triggerValue,
        active: s.active,
        team: s.team,
        aidaStage: s.aidaStage,
        totalSteps: steps.length,
        totalEnrolled: sTotal,
        activeCount: t.active,
        completedCount: t.completed,
        stoppedCount: t.stopped,
        failedCount: t.failed,
        completionRate: t.completionRate,
        stoppedRate: t.stoppedRate,
        failedRate: t.failedRate,
        steps: stepMetrics,
        errors: topErrors,
      };
    });

  // ── Trend ──
  // Bucketed, not one row per date that happened to have an enrolment. A dense
  // map skips quiet days entirely, so a week with one enrolment on Monday and
  // one on Friday drew two bars side by side as if they were consecutive.
  const stamps = allEnrs
    .map(e => e.created_at as string | null)
    .filter((v): v is string => typeof v === "string" && v.length >= 10);
  const now = new Date();
  const earliest = stamps.length ? new Date(stamps.reduce((a, b) => (a < b ? a : b))) : null;
  const granularity: Granularity = granularityFor(dripRangeSpanDays(range, earliest, now));

  const counts = new Map<string, { enrolled: number; completed: number; stopped: number; failed: number }>();
  for (const e of allEnrs) {
    const iso = e.created_at as string | null;
    if (!iso) continue;
    const k = bucketKey(iso, granularity);
    let b = counts.get(k);
    if (!b) { b = { enrolled: 0, completed: 0, stopped: 0, failed: 0 }; counts.set(k, b); }
    b.enrolled++;
    const status = e.status as string;
    if (status === "completed") b.completed++;
    else if (status === "stopped") b.stopped++;
    else if (status === "failed") b.failed++;
  }

  const from = windowStart ?? earliest;
  const dailyTrend = from
    ? bucketKeys(from, now, granularity).map(date => ({
        date,
        ...(counts.get(date) ?? { enrolled: 0, completed: 0, stopped: 0, failed: 0 }),
      }))
    : [];

  return {
    overview,
    statusCounts,
    bySequence,
    dailyTrend,
    granularity,
    sequences: seqs.map(s => ({ id: s.id, name: s.name, platform: s.platform, active: s.active })),
    truncated,
    scanned: scanned.length,
    filter: { sequenceId: seqId, range, status: statusFilter, platform },
  };
}

// ── Execution ─────────────────────────────────────────────────────────────────
/**
 * Put the drip message in Live Chat, where the counsellor will look.
 *
 * Until now a sequence pushed its sends to the LeadSquared timeline and
 * nowhere else, so a counsellor opening the conversation saw the lead's reply
 * with nothing above it — no sign of what they were replying TO. Four weeks
 * of nurture were invisible in the only screen a counsellor actually uses.
 *
 * Best-effort: a logging failure must never turn a delivered message into a
 * retried one.
 */
async function logDripSend(
  enr: Record<string, unknown>, seq: Sequence, body: string, metaId: string | undefined,tenantId = DEFAULT_TENANT_ID
): Promise<void> {
  try {
    const convId = (enr.conversation_id as string | null)
      ?? (await getOrCreateConversation(enr.phone as string, undefined, seq.channelId ?? null, undefined, tenantId)).id;
    if (!convId) return;
    await appendConvMessage({ tenantId, 
      conversationId: convId, role: "assistant", body, metaId: metaId ?? null,
      source: "bot", channelId: seq.channelId ?? null,
    });
    // The row in the inbox list, not just the thread. Without this the
    // conversation shows no preview line and no time — a drip lead appears
    // in Live Chat as a name with nothing under it, which reads like a
    // conversation that never happened.
    //
    // It also sets last_outbound_at, which drainInactiveLeads reads to find
    // "the bot spoke last and they never replied". That is exactly a lead
    // part-way through a nurture, so the two must not collide: enroll()
    // refuses a lead already on another journey, and drainInactiveLeads
    // checks hasActiveEnrollment before it starts one. A lead who FINISHES
    // the drip is fair game for a re-engagement nudge, which is the right
    // answer rather than an oversight.
    await touchOutbound(convId, body);
    // A receipt Meta's delivery callback can find. Without one, an accepted
    // send that Meta then drops is recorded nowhere at all.
    await recordSequenceSend({ tenantId,  phone: enr.phone as string, name: null, metaMessageId: metaId ?? null }, tenantId);
  } catch (e) {
    console.error(JSON.stringify({ tag: "sequence_log_failed", seq: seq.id, error: String(e) }));
  }
}

/** One line describing a step, for the chat log and the CRM timeline. */
function describeStep(a: SequenceStepAction | undefined): string {
  if (a?.type === "template" && a.templateName) return `template "${a.templateName}"`;
  if (a?.type === "media") return `media ${a.caption ?? a.url ?? ""}`.trim();
  return (a?.text ?? "").slice(0, 300) || "step";
}

async function executeStep(seq: Sequence, enr: Record<string, unknown>, step: SequenceStep, tenantId = DEFAULT_TENANT_ID): Promise<{ ok: boolean; error?: string }> {
  const channel = seq.channelId ? (await getChannel(seq.channelId, tenantId)) ?? undefined : undefined;
  if (!channel && tenantId !== DEFAULT_TENANT_ID) return { ok: false, error: "Select a connected sending channel for this journey" };
  const phone = enr.phone as string;
  const a = step.action;

  if ((enr.platform as string) === "instagram") {
    if (!channel?.igUserId) return { ok: false, error: "Instagram channel missing" };
    if (a.type !== "text" || !a.text) return { ok: true };   // IG drip supports text only
    const conv = await getConversationByPhone(phone, tenantId);
    const r = await sendIgMessage({ igUserId: channel.igUserId, token: channel.token }, phone, a.text, { lastInboundAt: conv?.lastInboundAt ?? null });
    return { ok: r.ok, error: r.error };
  }

  // WhatsApp — channel (Channel) is assignable to ChannelCreds; undefined → env default.
  // Templates are always allowed (Meta-approved, no window). Free-form text/media
  // may only be sent INSIDE the 24h customer-service window — sequences are
  // time-delayed and routinely fire after it closes (the inactivity 24h nudge
  // especially), so we gate exactly like flowengine/assistant or we risk a
  // closed-window send (a top Meta ban trigger).
  if (a.type === "template" && a.templateName) {
    // ── Fill the blanks for THIS lead ────────────────────────────────────
    //
    // A step's params are one list shared by everybody on the journey, so a
    // literal value would greet four thousand people by the same name.
    // Written as `{first_name}` / `{course}` / `{min_ctc}` they resolve per
    // lead here, through the same substitution the one-click canned
    // templates in Live Chat already use.
    //
    // A token that resolves to nothing is NOT sent as a blank. Meta rejects
    // an empty parameter with #132000, and the times it does not, the lead
    // reads "Hi , welcome to Acme". Skipped with a reason is the
    // better failure, and it is visible on the enrolment.
    let params = a.params ?? [];
    if (params.some(p => /\{\w+\}/.test(p ?? ""))) {
      const contact = await getContactByPhoneLoose(phone, tenantId).catch(() => null);
      const tokens = leadTokens(contact);
      const missing = missingTokens(params, tokens);
      if (missing.length) {
        return { ok: false, error: `Not sent: no value for ${missing.map(m => `{${m}}`).join(", ")} on this lead` };
      }
      params = resolveCannedParams(params, tokens);
    }
    const r = await sendTemplateSingle(phone, a.templateName, a.languageCode ?? "en_US", params, channel);
    if (r.error) {
      // "Not on WhatsApp" is the one send failure that says something about
      // the LEAD rather than about us, and the brief asks for it to be
      // visible. Everything else is ours to fix and stays on last_error.
      if (r.code === WA_NOT_ON_WHATSAPP) {
        await markNumberNotOnWhatsApp(phone, `Meta ${r.code}: ${r.error}`, tenantId).catch(() => false);
      }
      return { ok: false, error: r.error };
    }
    // Store the message the LEAD received, not the template's name. params are
    // already resolved above; a render miss falls back to the name label.
    const rendered = await renderTemplateBody(a.templateName, a.languageCode ?? "en_US", params, channel);
    await logDripSend(enr, seq, rendered ?? describeStep(a), r.id, tenantId);
    return { ok: true };
  }
  if (a.type === "text" || a.type === "media") {
    const conv = await getConversationByPhone(phone, tenantId);
    if (!within24hWindow(conv?.lastInboundAt ?? null)) {
      // Skip (don't fail) so the sequence keeps advancing; record why for the UI.
      return { ok: false, error: "Skipped: outside 24h window — use an approved template for this step" };
    }
    if (a.type === "text" && a.text) {
      const r = await sendText(phone, a.text, channel);
      if (r.error) {
        if (r.code === WA_NOT_ON_WHATSAPP) await markNumberNotOnWhatsApp(phone, `Meta ${r.code}: ${r.error}`, tenantId).catch(() => false);
        return { ok: false, error: r.error };
      }
      await logDripSend(enr, seq, a.text, r.id, tenantId);
      return { ok: true };
    }
    if (a.type === "media" && a.url) {
      const r = await sendMedia(phone, a.mediaKind ?? "image", a.url, a.caption, channel);
      if (r.error) return { ok: false, error: r.error };
      await logDripSend(enr, seq, describeStep(a), r.id, tenantId);
      return { ok: true };
    }
  }
  return { ok: true };   // empty/unknown step → no-op, just advance
}

// Drain due enrollments — called by the cron. Advances each one step; failures
// are recorded but still advance (so a bad step never wedges the sequence).
async function drainSequencesForTenant(max = 100, tenantId = DEFAULT_TENANT_ID): Promise<number> {
  const now = new Date().toISOString();

  // ── The daily ceiling applies to drips too ─────────────────────────────
  //
  // It did not. quota.ts was wired into broadcasts, the assistant and the
  // public API, and not into this loop — so the cap that exists to keep a
  // number inside Meta's limit governed everything EXCEPT the one sender
  // that enrols people in bulk.
  //
  // The sequence's own maxPerDay paces a CONTACT. It says nothing about a
  // thousand contacts each receiving their one message the same morning,
  // which is exactly what a bulk stage change in the CRM produces: four
  // leads were moved onto "Not Reachable" in the same second on 11 Oct, and
  // that stage holds around a thousand.
  //
  // Counted against the same log the broadcasts count against, deliberately.
  // Meta's limit is per number per day and does not care which part of our
  // system sent it, so one shared ceiling is the only correct reading.
  const cap = await getDailyCap(tenantId);
  let headroom = Math.max(0, cap - (await dailySentCount(tenantId).catch(() => 0)));
  if (headroom <= 0) {
    console.warn(`[sequences] daily cap reached (${cap}) — deferring every due step`);
    return 0;
  }

  const { data } = await tdb(tenantId).from("wa_sequence_enrollments")
    .select("*").eq("status", "active").lte("next_run_at", now).order("next_run_at").limit(max);

  let processed = 0;
  for (const enr of (data ?? []) as unknown as Record<string, unknown>[]) {
    try {
      const seq = await getSequence(enr.sequence_id as string, tenantId);
      if (!seq || !seq.active) { await tdb(tenantId).from("wa_sequence_enrollments").update({ status: "stopped" }).eq("id", enr.id as string); continue; }
      // ── Stop the moment the lead comes back ──────────────────────────────
      //
      // This used to run for `inactivity` journeys only, on the reasoning that
      // other kinds "run to completion as designed". That reasoning does not
      // survive a nurture: a lead taps "Yes, call me now" on day 2, a
      // counsellor rings them, and the drip carries on delivering "Not sure
      // yet? See how we teach first" on day 5 into a live conversation.
      //
      // 0101 made it a property of the journey instead of a property of its
      // trigger, defaulting true. An inactivity sequence is unaffected — it
      // now takes the same path by setting rather than by special case.
      if (seq.stopOnReply) {
        const conv = await getConversationByPhone(enr.phone as string, tenantId).catch(() => null);
        if (shouldStopForReply(conv, enr.updated_at as string | null)) {
          await tdb(tenantId).from("wa_sequence_enrollments").update({ status: "stopped", updated_at: new Date().toISOString() }).eq("id", enr.id as string);
          continue;
        }
      }

      // ── Never past a STOP ────────────────────────────────────────────────
      //
      // The reply check above cannot see an opt-out: the STOP handler
      // suppresses the number and returns before the message reaches the
      // conversation, and a number can be suppressed from the portal or the
      // CRM without replying at all. So the suppression list is read here,
      // for every journey whatever its stop-on-reply setting. A lookup that
      // fails throws into the catch below — the step stays due and is
      // retried, never sent blind.
      if (await isOptedOutStrict(enr.phone as string, tenantId)) {
        await tdb(tenantId).from("wa_sequence_enrollments").update({ status: "stopped", last_error: "opted out", updated_at: new Date().toISOString() }).eq("id", enr.id as string);
        continue;
      }

      // ── Hold until the sending window opens ──────────────────────────────
      //
      // Steps fire on elapsed delay alone, so a lead marked Not Reachable at
      // 23:10 was greeted at 23:10 the next night. DEFERRED rather than
      // skipped: the step keeps its turn and takes it at the next opening,
      // because a nurture message nobody sent is a lead nobody contacted and
      // nothing in the UI would ever show it.
      //
      // Checked before the claim, so a deferral costs one cheap write and
      // never burns the step's lease.
      const win = { startHour: seq.sendStartHour, endHour: seq.sendEndHour };
      if (hasWindow(win) && !withinSendWindow(win, new Date())) {
        await tdb(tenantId).from("wa_sequence_enrollments")
          .update({ next_run_at: nextWindowOpening(win, new Date()).toISOString() })
          .eq("id", enr.id as string).eq("status", "active");
        continue;
      }
      // ── Hold if this lead has already heard from us today ───────────────
      //
      // "One message per day at most." Steps are spaced by delay alone, so
      // nothing stopped two landing in the same afternoon once a deferral had
      // moved one — and deferral is routine now that 0101's window pushes
      // every out-of-hours step to the next opening, where it meets whatever
      // was already due there.
      //
      // Counted across EVERY journey and against what was actually logged as
      // sent, not against this enrolment's own history: the lead does not
      // know which campaign a message came from.
      //
      // Deferred to tomorrow's opening, never dropped, for the same reason
      // the window defers.
      if (seq.maxPerDay && (enr.platform as string) !== "instagram") {
        const convId = (enr.conversation_id as string | null)
          ?? (await getConversationByPhone(enr.phone as string, tenantId).catch(() => null))?.id
          ?? null;
        if (convId) {
          const { from, to } = localDayBounds(new Date());
          const sentToday = await countAutomatedSends(convId, from.toISOString(), to.toISOString(), tenantId).catch(() => 0);
          if (sentToday >= seq.maxPerDay) {
            await tdb(tenantId).from("wa_sequence_enrollments")
              .update({ next_run_at: nextDayOpening(win, new Date()).toISOString() })
              .eq("id", enr.id as string).eq("status", "active");
            continue;
          }
        }
      }

      const steps = await getSequenceSteps(seq.id, tenantId);
      const idx = (enr.current_step as number) ?? 0;
      const step = steps[idx];
      if (!step) { await tdb(tenantId).from("wa_sequence_enrollments").update({ status: "completed", updated_at: new Date().toISOString() }).eq("id", enr.id as string); continue; }

      // Atomic claim before sending: compare-and-swap this row out of the due set —
      // only the runner that still sees the exact next_run_at we read wins. Stops two
      // overlapping cron ticks (the 1-min pinger + GitHub */5, which can run at once)
      // from both executing the same step and double-sending the nudge. A crash after
      // the claim leaves a short lease so the row retries once it expires, not wedges.
      // Out of headroom mid-pass: DEFER, never drop — the same rule the
      // sending window and maxPerDay already follow. A nurture message nobody
      // sent is a lead nobody contacted, and nothing in the UI would show it.
      if ((enr.platform as string) !== "instagram" && headroom <= 0) {
        await tdb(tenantId).from("wa_sequence_enrollments")
          .update({ next_run_at: new Date(Date.now() + 60 * 60_000).toISOString() })
          .eq("id", enr.id as string).eq("status", "active");
        continue;
      }

      const lease = new Date(Date.now() + 5 * 60_000).toISOString();
      const claimed = await tdb(tenantId).from("wa_sequence_enrollments")
        .update({ next_run_at: lease })
        .eq("id", enr.id as string).eq("status", "active").eq("next_run_at", enr.next_run_at as string)
        .select("id");
      if (!claimed.data?.length) continue;   // another tick already claimed this step

      // ── Is this step for this lead? ─────────────────────────────────────
      //
      // Some messages are not for everybody: e.g. an event invitation
      // invitation skips leads who already registered, the results message
      // carries claims that only some programmes can make, and the centre
      // visit is meaningless to an online-only course or a lead in another
      // city.
      //
      // A miss SKIPS this step and advances — it does not end the journey.
      // A lead who cannot visit a centre should still get R+21 and R+28.
      //
      // Checked after the claim because skipping still consumes the step, and
      // an unclaimed advance could be made twice by two overlapping ticks.
      let res: { ok: boolean; error?: string };
      let skippedFor = "";
      if (step.audience) {
        const contact = await getContactByPhoneLoose(enr.phone as string, tenantId).catch(() => null);
        if (!matchesAudience(step.audience, contact)) {
          skippedFor = describeAudience(step.audience);
          res = { ok: true };
        } else {
          res = await executeStep(seq, enr, step, tenantId);
        }
      } else {
        res = await executeStep(seq, enr, step, tenantId);
      }

      // One fewer message available today. Counted only when a WhatsApp step
      // actually went: an audience skip, a refused template (a token with no
      // value) and an Instagram step all report ok without consuming any of
      // Meta's allowance for this number.
      if (res.ok && !skippedFor && (enr.platform as string) !== "instagram") headroom--;

      // ── Where a drip send is recorded in the CRM ────────────────────────
      //
      if (skippedFor) {
        console.log(JSON.stringify({
          tag: "sequence_step_skipped", seq: seq.name, step: idx,
          audience: skippedFor, phone: (enr.phone as string).slice(-4),
        }));
      }

      const nextStep = steps[idx + 1];
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), last_error: res.ok ? null : (res.error ?? "send failed") };
      if (!nextStep) { patch.status = "completed"; }
      else { patch.current_step = idx + 1; patch.next_run_at = new Date(Date.now() + Math.max(0, nextStep.delayMinutes) * 60_000).toISOString(); }
      await tdb(tenantId).from("wa_sequence_enrollments").update(patch).eq("id", enr.id as string);
      processed++;
    } catch (e) {
      console.error("[sequences] drain error:", e);
    }
  }
  return processed;
}

// Inactivity re-engagement — enroll conversations that have gone quiet (the bot
// sent the last message and the lead never replied) into the "inactivity"
// sequence, so a staged nudge (e.g. 10 min → 3 h → 24 h) can win them back.
// The sequence's triggerValue is the minutes of silence before the FIRST step;
// each later step then waits its own delayMinutes. Nudges stop automatically on
// reply or human takeover (see drainSequences). NOTE: any step that can land
// >24 h after the lead's last inbound MUST be a WhatsApp template (action.type
// 'template') — free session text is rejected outside the 24-hour window.
async function drainInactiveLeadsForTenant(max = 100, tenantId = DEFAULT_TENANT_ID): Promise<number> {
  const seq = await getSequenceByTrigger("inactivity", undefined, tenantId);
  if (!seq) return 0;   // no inactivity sequence configured → nothing to do
  const idleMinutes = Math.max(1, parseInt(seq.triggerValue ?? "", 10) || 10);
  const cutoff = new Date(Date.now() - idleMinutes * 60_000).toISOString();
  const { data } = await tdb(tenantId).from("wa_conversations")
    .select("id, phone, platform, last_inbound_at, last_outbound_at")
    .eq("status", "active").eq("bot_enabled", true).eq("platform", seq.platform)
    .not("last_outbound_at", "is", null).lte("last_outbound_at", cutoff)
    .limit(max);

  let started = 0;
  for (const c of (data ?? []) as unknown as Record<string, unknown>[]) {
    const phone = c.phone as string;
    if (!phone) continue;
    const li = c.last_inbound_at as string | null;
    const lo = c.last_outbound_at as string | null;
    // Only chats genuinely awaiting a reply (the bot spoke last).
    if (!lo || (li && new Date(li) >= new Date(lo))) continue;
    // Don't collide with an active drip (this or any other sequence).
    if (await hasActiveEnrollment(phone, tenantId)) continue;
    // Don't re-nudge the same silent stretch: if we already ran this sequence for
    // them and they haven't replied since, skip (otherwise nudges would loop).
    const { data: ex } = await tdb(tenantId).from("wa_sequence_enrollments")
      .select("updated_at").eq("sequence_id", seq.id).eq("phone", phone).maybeSingle();
    if (ex) {
      const exUpdated = (ex as unknown as Record<string, unknown>).updated_at as string | null;
      if (!li || !exUpdated || new Date(li) <= new Date(exUpdated)) continue;
    }
    try {
      await enroll(seq.id, { phone, platform: (c.platform as "whatsapp" | "instagram") ?? seq.platform, conversationId: (c.id as string) ?? null }, tenantId);
      started++;
    } catch (e) { console.error("[sequences] inactivity enroll", e); }
  }
  return started;
}

// Cron entry points find WHICH workspaces have work in one query, then do the
// per-workspace part only for those. Walking every tenant instead (an
// entitlement check, a daily-cap count and a query each, serially) cost ~15s a
// tick with nothing due, and inside the cron's shared 45s budget that starved
// every stage after it — CRM sync, integration deliveries, owner emails.
export async function drainSequences(max = 100, tenantId?: string): Promise<number> {
  if (tenantId) return await accountCanSend(tenantId) ? drainSequencesForTenant(max, tenantId) : 0;
  const { data, error } = await db().from("wa_sequence_enrollments").select("tenant_id")
    .eq("status", "active").lte("next_run_at", new Date().toISOString()).order("next_run_at").limit(max);
  if (error) throw error;
  let count = 0;
  for (const id of uniqueTenants(data)) { if (count >= max) break; count += await drainSequences(max - count, id); }
  return count;
}

export async function drainInactiveLeads(max = 100, tenantId?: string): Promise<number> {
  if (tenantId) return await accountCanSend(tenantId) ? drainInactiveLeadsForTenant(max, tenantId) : 0;
  // Only workspaces with a live inactivity journey have anything to do.
  const { data, error } = await db().from("wa_sequences").select("tenant_id")
    .eq("trigger_kind", "inactivity").eq("active", true);
  if (error) throw error;
  let count = 0;
  for (const id of uniqueTenants(data)) { if (count >= max) break; count += await drainInactiveLeads(max - count, id); }
  return count;
}

function uniqueTenants(rows: unknown): string[] {
  return [...new Set(((rows ?? []) as { tenant_id: string | null }[]).map(r => r.tenant_id).filter((t): t is string => !!t))];
}
