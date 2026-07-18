import { DEFAULT_TENANT_ID } from "./tenant";
// Sequences (drip) — timed, multi-step automations. The backbone for follow-up
// nurture AND cart recovery AND post-purchase. Enrollment is created by any
// event (keyword, opt-in, story_reply, tag, cart_abandoned…); the cron advances
// due enrollments through the steps.
//
// Compliance: Instagram steps only send inside the 24h window (instagram.ts
// enforces it). WhatsApp steps outside the window must use an approved template
// (action.type = 'template'); session text/media only land inside the window.

import { db } from "./supabase";
import { tdb } from "./tenantdb";
import { getChannel } from "./channels";
import { sendText, sendTemplateSingle, sendMedia } from "./whatsapp";
import { sendIgMessage, within24hWindow } from "./instagram";
import { getConversationByPhone } from "./store";
import { pushWaActivity } from "./leadsquared";


export type SequenceTriggerKind =
  | "manual" | "keyword" | "tag_added" | "opt_in" | "story_reply"
  | "comment" | "cart_abandoned" | "order_placed" | "ad_referral" | "inactivity";

export interface SequenceStepAction {
  type: "text" | "template" | "media";
  text?: string;
  templateName?: string; languageCode?: string; params?: string[];
  mediaKind?: "image" | "video" | "document" | "audio"; url?: string; caption?: string;
}
export interface SequenceStep { id: string; stepIndex: number; delayMinutes: number; action: SequenceStepAction }
export interface Sequence {
  id: string; name: string; channelId: string | null;
  platform: "whatsapp" | "instagram"; triggerKind: SequenceTriggerKind;
  triggerValue: string | null; active: boolean; tenantId: string;
}

function mapSeq(r: Record<string, unknown>): Sequence {
  return {
    id: r.id as string, name: r.name as string, channelId: (r.channel_id as string | null) ?? null,
    platform: (r.platform as Sequence["platform"]) ?? "whatsapp",
    triggerKind: (r.trigger_kind as SequenceTriggerKind) ?? "manual",
    triggerValue: (r.trigger_value as string | null) ?? null, active: (r.active as boolean) ?? true,
    tenantId: (r.tenant_id as string) ?? DEFAULT_TENANT_ID,
  };
}

// ── CRUD ──────────────────────────────────────────────────────────────────────
export async function listSequences(tenantId = DEFAULT_TENANT_ID): Promise<Sequence[]> {
  const { data } = await tdb(tenantId).from("wa_sequences").select("*").order("created_at", { ascending: false });
  return ((data ?? []) as unknown as Record<string, unknown>[]).map(r => mapSeq(r));
}

// tenantId optional: cron resolves by id (carries tenant on the row); admin scopes.
// Stays on raw db() — tdb() can't express the conditional tenant filter and would
// throw on the cron path where tenantId is undefined.
export async function getSequence(id: string, tenantId?: string): Promise<Sequence | null> {
  let q = db().from("wa_sequences").select("*").eq("id", id);
  if (tenantId) q = q.eq("tenant_id", tenantId);
  const { data } = await q.maybeSingle();
  return data ? mapSeq(data as Record<string, unknown>) : null;
}

export async function createSequence(p: { name: string; channelId?: string | null; platform?: "whatsapp" | "instagram"; triggerKind?: SequenceTriggerKind; triggerValue?: string | null }, tenantId = DEFAULT_TENANT_ID): Promise<Sequence> {
  const { data, error } = await tdb(tenantId).from("wa_sequences").insert({
    name: p.name.trim(), channel_id: p.channelId ?? null, platform: p.platform ?? "whatsapp",
    trigger_kind: p.triggerKind ?? "manual", trigger_value: p.triggerValue ?? null,
  }).select().single();
  if (error) throw error;
  return mapSeq(data as Record<string, unknown>);
}

export async function updateSequence(id: string, p: Partial<{ name: string; channelId: string | null; platform: "whatsapp" | "instagram"; triggerKind: SequenceTriggerKind; triggerValue: string | null; active: boolean }>, tenantId = DEFAULT_TENANT_ID): Promise<void> {
  const row: Record<string, unknown> = {};
  if (p.name !== undefined) row.name = p.name.trim();
  if (p.channelId !== undefined) row.channel_id = p.channelId;
  if (p.platform !== undefined) row.platform = p.platform;
  if (p.triggerKind !== undefined) row.trigger_kind = p.triggerKind;
  if (p.triggerValue !== undefined) row.trigger_value = p.triggerValue;
  if (p.active !== undefined) row.active = p.active;
  if (Object.keys(row).length) { const { error } = await tdb(tenantId).from("wa_sequences").update(row).eq("id", id); if (error) throw error; }
}

export async function deleteSequence(id: string, tenantId = DEFAULT_TENANT_ID): Promise<void> {
  await tdb(tenantId).from("wa_sequences").delete().eq("id", id);   // steps + enrollments cascade
}

export async function setSequenceSteps(sequenceId: string, steps: { delayMinutes: number; action: SequenceStepAction }[], tenantId = DEFAULT_TENANT_ID): Promise<void> {
  // Delete is tenant-scoped as well as sequence-scoped: the caller already
  // validated sequenceId belongs to tenantId, but scoping the delete too means a
  // mismatched pair can never clear another tenant's steps.
  await tdb(tenantId).from("wa_sequence_steps").delete().eq("sequence_id", sequenceId);
  if (!steps.length) return;
  const rows = steps.map((s, i) => ({ sequence_id: sequenceId, step_index: i, delay_minutes: Math.max(0, Math.round(s.delayMinutes)), action: s.action }));
  const { error } = await tdb(tenantId).from("wa_sequence_steps").insert(rows);
  if (error) throw error;
}

// tenantId optional but preferred: scopes the read as defense-in-depth. The
// sequenceId always comes from a tenant-scoped lookup, so this can't leak — but
// scoping keeps a foreign sequenceId from ever reading another tenant's steps.
export async function getSequenceSteps(sequenceId: string, tenantId?: string): Promise<SequenceStep[]> {
  let q = db().from("wa_sequence_steps").select("*").eq("sequence_id", sequenceId);
  if (tenantId) q = q.eq("tenant_id", tenantId);
  const { data } = await q.order("step_index");
  return (data ?? []).map(r => ({
    id: r.id as string, stepIndex: r.step_index as number, delayMinutes: (r.delay_minutes as number) ?? 0,
    action: (r.action as SequenceStepAction) ?? { type: "text" },
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
// trimmed, platform- and tenant-scoped). The inbound webhooks call this: when a
// contact sends the exact trigger word we enroll them and let the drip drive.
export async function matchKeywordSequence(platform: "whatsapp" | "instagram", text: string, tenantId = DEFAULT_TENANT_ID): Promise<Sequence | null> {
  const v = (text ?? "").trim().toLowerCase();
  if (!v) return null;
  const { data } = await tdb(tenantId).from("wa_sequences").select("*")
    .eq("trigger_kind", "keyword").eq("active", true).eq("platform", platform)
    .order("created_at", { ascending: false });
  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  const row = rows.find(r => ((r.trigger_value as string) ?? "").trim().toLowerCase() === v);
  return row ? mapSeq(row) : null;
}

// ── Enrollment ──────────────────────────────────────────────────────────────
export async function enroll(sequenceId: string, p: { phone: string; platform?: "whatsapp" | "instagram"; conversationId?: string | null }, tenantId = DEFAULT_TENANT_ID): Promise<void> {
  const steps = await getSequenceSteps(sequenceId, tenantId);
  if (!steps.length) return;
  const firstDelayMs = Math.max(0, steps[0].delayMinutes) * 60_000;
  const nextRun = new Date(Date.now() + firstDelayMs).toISOString();
  await tdb(tenantId).from("wa_sequence_enrollments").upsert({
    sequence_id: sequenceId, phone: p.phone, platform: p.platform ?? "whatsapp",
    conversation_id: p.conversationId ?? null, current_step: 0, status: "active",
    next_run_at: nextRun, updated_at: new Date().toISOString(),
  }, { onConflict: "sequence_id,phone" });
}

export async function stopEnrollment(sequenceId: string, phone: string): Promise<void> {
  await db().from("wa_sequence_enrollments").update({ status: "stopped", updated_at: new Date().toISOString() })
    .eq("sequence_id", sequenceId).eq("phone", phone);
}

// Is this contact currently being driven by a drip (tenant-scoped)? Used to
// suppress the welcome + AI auto-reply while a sequence owns the conversation, so
// they don't collide (the drip drives until it completes/stops, then AI resumes).
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
  const ids = [...new Set(((data ?? []) as unknown as Record<string, unknown>[]).map(r => r.sequence_id as string))];
  if (!ids.length) return false;
  // by-id lookup within ids already scoped to this tenant above; stays raw db().
  const { data: seqs } = await db().from("wa_sequences").select("id").in("id", ids).neq("trigger_kind", "inactivity");
  return (seqs?.length ?? 0) > 0;
}

// Recent enrollments (joined with the sequence name) for the admin monitor —
// who's in a drip, which step, when it next runs, any send error. Tenant-scoped.
export interface EnrollmentRow {
  id: string; sequenceId: string; sequenceName: string; phone: string; platform: string;
  currentStep: number; status: string; nextRunAt: string | null; lastError: string | null;
  updatedAt: string | null; createdAt: string | null;
}
export async function listRecentEnrollments(limit = 100, tenantId = DEFAULT_TENANT_ID): Promise<EnrollmentRow[]> {
  const { data } = await tdb(tenantId).from("wa_sequence_enrollments").select("*").order("updated_at", { ascending: false }).limit(limit);
  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  const ids = [...new Set(rows.map(r => r.sequence_id as string))];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: sd } = await tdb(tenantId).from("wa_sequences").select("id,name").in("id", ids);
    for (const s of (sd ?? []) as unknown as Record<string, unknown>[]) names.set(s.id as string, s.name as string);
  }
  return rows.map(r => ({
    id: r.id as string, sequenceId: r.sequence_id as string, sequenceName: names.get(r.sequence_id as string) ?? "—",
    phone: r.phone as string, platform: (r.platform as string) ?? "whatsapp",
    currentStep: (r.current_step as number) ?? 0, status: (r.status as string) ?? "active",
    nextRunAt: (r.next_run_at as string | null) ?? null, lastError: (r.last_error as string | null) ?? null,
    updatedAt: (r.updated_at as string | null) ?? null, createdAt: (r.created_at as string | null) ?? null,
  }));
}

// ── Execution ─────────────────────────────────────────────────────────────────
async function executeStep(seq: Sequence, enr: Record<string, unknown>, step: SequenceStep): Promise<{ ok: boolean; error?: string }> {
  const channel = seq.channelId ? (await getChannel(seq.channelId)) ?? undefined : undefined;
  const phone = enr.phone as string;
  const a = step.action;

  if ((enr.platform as string) === "instagram") {
    if (!channel?.igUserId) return { ok: false, error: "Instagram channel missing" };
    if (a.type !== "text" || !a.text) return { ok: true };   // IG drip supports text only
    const conv = await getConversationByPhone(phone, seq.tenantId);
    const r = await sendIgMessage({ igUserId: channel.igUserId, token: channel.token }, phone, a.text, { lastInboundAt: conv?.lastInboundAt ?? null });
    return { ok: r.ok, error: r.error };
  }

  // WhatsApp — channel (Channel) is assignable to ChannelCreds; undefined → env default.
  // Templates are always allowed (Meta-approved, no window). Free-form text/media
  // may only be sent INSIDE the 24h customer-service window — sequences are
  // time-delayed and routinely fire after it closes, so we must gate exactly like
  // flowengine/assistant or we risk a closed-window send (a top Meta ban trigger).
  if (a.type === "template" && a.templateName) { const r = await sendTemplateSingle(phone, a.templateName, a.languageCode ?? "en_US", a.params ?? [], channel); return { ok: !r.error, error: r.error }; }
  if (a.type === "text" || a.type === "media") {
    const conv = await getConversationByPhone(phone, seq.tenantId);
    if (!within24hWindow(conv?.lastInboundAt ?? null)) {
      // Skip (don't fail) so the sequence keeps advancing; record why for the UI.
      return { ok: false, error: "Skipped: outside 24h window — use an approved template for this step" };
    }
    if (a.type === "text" && a.text) { const r = await sendText(phone, a.text, channel); return { ok: !r.error, error: r.error }; }
    if (a.type === "media" && a.url) { const r = await sendMedia(phone, a.mediaKind ?? "image", a.url, a.caption, channel); return { ok: !r.error, error: r.error }; }
  }
  return { ok: true };   // empty/unknown step → no-op, just advance
}

// Drain due enrollments — called by the cron. Advances each one step; failures
// are recorded but still advance (so a bad step never wedges the sequence).
export async function drainSequences(max = 100, tenantId?: string): Promise<number> {
  const now = new Date().toISOString();
  let q = db().from("wa_sequence_enrollments").select("*").eq("status", "active").lte("next_run_at", now);
  if (tenantId) q = q.eq("tenant_id", tenantId);   // admin "run now" scopes to one tenant; cron drains all
  const { data } = await q.order("next_run_at").limit(max);

  let processed = 0;
  for (const enr of (data ?? []) as Record<string, unknown>[]) {
    try {
      const seq = await getSequence(enr.sequence_id as string, (enr.tenant_id as string) ?? DEFAULT_TENANT_ID);
      if (!seq || !seq.active) { await db().from("wa_sequence_enrollments").update({ status: "stopped" }).eq("id", enr.id as string); continue; }
      // Inactivity re-engagement nudges must STOP the moment the lead replies or a
      // human takes over — never keep nudging someone who came back or is being
      // handled by a person. (Other sequence kinds run to completion as designed.)
      if (seq.triggerKind === "inactivity") {
        const conv = await getConversationByPhone(enr.phone as string, seq.tenantId).catch(() => null);
        const exUpdated = enr.updated_at as string | null;
        const repliedSince = !!conv?.lastInboundAt && !!exUpdated && new Date(conv.lastInboundAt) > new Date(exUpdated);
        const humanTookOver = !!conv && (conv.botEnabled === false || conv.status !== "active");
        if (repliedSince || humanTookOver) {
          await db().from("wa_sequence_enrollments").update({ status: "stopped", updated_at: new Date().toISOString() }).eq("id", enr.id as string);
          continue;
        }
      }
      const steps = await getSequenceSteps(seq.id);
      const idx = (enr.current_step as number) ?? 0;
      const step = steps[idx];
      if (!step) { await db().from("wa_sequence_enrollments").update({ status: "completed", updated_at: new Date().toISOString() }).eq("id", enr.id as string); continue; }

      // Atomic claim before sending: compare-and-swap this row out of the due set —
      // only the runner that still sees the exact next_run_at we read wins. Stops two
      // overlapping cron ticks (the 1-min pinger + GitHub */5, which can run at once)
      // from both executing the same step and double-sending the nudge. A crash after
      // the claim leaves a short lease so the row retries once it expires, not wedges.
      const lease = new Date(Date.now() + 5 * 60_000).toISOString();
      const claimed = await db().from("wa_sequence_enrollments")
        .update({ next_run_at: lease })
        .eq("id", enr.id as string).eq("status", "active").eq("next_run_at", enr.next_run_at as string)
        .select("id");
      if (!claimed.data?.length) continue;   // another tick already claimed this step

      const res = await executeStep(seq, enr, step);

      // Successful WhatsApp drip steps land on the LSQ timeline (queue-backed)
      // so counselors see nurture touches in the CRM. IG enrollments are
      // handle-keyed — no phone to attach to — and stay chat-log-only.
      if (res.ok && (enr.platform as string) !== "instagram") {
        const a = step.action;
        const summary = a?.type === "template" && a.templateName ? `template "${a.templateName}"`
          : a?.type === "media" ? `media ${a.caption ?? a.url ?? ""}`.trim()
          : (a?.text ?? "").slice(0, 300) || "step";
        void pushWaActivity({ phone: enr.phone as string, direction: "outbound", body: `Sequence "${seq.name}" — ${summary}`, via: "bot", tenantId: (enr.tenant_id as string) ?? undefined });
      }

      const nextStep = steps[idx + 1];
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), last_error: res.ok ? null : (res.error ?? "send failed") };
      if (!nextStep) { patch.status = "completed"; }
      else { patch.current_step = idx + 1; patch.next_run_at = new Date(Date.now() + Math.max(0, nextStep.delayMinutes) * 60_000).toISOString(); }
      await db().from("wa_sequence_enrollments").update(patch).eq("id", enr.id as string);
      processed++;
    } catch (e) {
      console.error("[sequences] drain error:", e);
    }
  }
  return processed;
}

// Inactivity re-engagement — enroll conversations that have gone quiet (the bot
// sent the last message and the lead never replied) into their tenant's
// "inactivity" sequence, so a staged nudge (e.g. 10 min → 3 h → 24 h) can win
// them back. Each tenant's sequence triggerValue is the minutes of silence
// before the FIRST step; later steps use their own delays. Nudges stop on reply
// or human takeover (see drainSequences). Any step >24 h after the lead's last
// inbound MUST be a WhatsApp template — free session text is rejected then.
export async function drainInactiveLeads(max = 100): Promise<number> {
  // Only tenants with an active inactivity sequence do any work.
  const { data: seqs } = await db().from("wa_sequences")
    .select("id, tenant_id, platform, trigger_value")
    .eq("trigger_kind", "inactivity").eq("active", true);

  let started = 0;
  for (const s of (seqs ?? []) as Record<string, unknown>[]) {
    const tid = (s.tenant_id as string) ?? DEFAULT_TENANT_ID;
    const seqId = s.id as string;
    const platform = (s.platform as "whatsapp" | "instagram") ?? "whatsapp";
    const idleMinutes = Math.max(1, parseInt((s.trigger_value as string) ?? "", 10) || 10);
    const cutoff = new Date(Date.now() - idleMinutes * 60_000).toISOString();
    const { data } = await db().from("wa_conversations")
      .select("id, phone, platform, last_inbound_at, last_outbound_at")
      .eq("tenant_id", tid).eq("status", "active").eq("bot_enabled", true).eq("platform", platform)
      .not("last_outbound_at", "is", null).lte("last_outbound_at", cutoff)
      .limit(max);

    for (const c of (data ?? []) as Record<string, unknown>[]) {
      const phone = c.phone as string;
      if (!phone) continue;
      const li = c.last_inbound_at as string | null;
      const lo = c.last_outbound_at as string | null;
      if (!lo || (li && new Date(li) >= new Date(lo))) continue;   // only chats awaiting a reply
      if (await hasActiveEnrollment(phone, tid)) continue;          // don't collide with another drip
      // Don't re-nudge the same silent stretch unless the lead replied since.
      const { data: ex } = await db().from("wa_sequence_enrollments")
        .select("updated_at").eq("sequence_id", seqId).eq("phone", phone).maybeSingle();
      if (ex) {
        const exUpdated = (ex as Record<string, unknown>).updated_at as string | null;
        if (!li || !exUpdated || new Date(li) <= new Date(exUpdated)) continue;
      }
      try {
        await enroll(seqId, { phone, platform: (c.platform as "whatsapp" | "instagram") ?? platform, conversationId: (c.id as string) ?? null }, tid);
        started++;
      } catch (e) { console.error("[sequences] inactivity enroll", e); }
    }
  }
  return started;
}
