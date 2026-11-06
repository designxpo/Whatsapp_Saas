// What is running for one customer, what happens next and when, and why
// anything stopped — so an owner can see (and stop) the automation behind a
// chat instead of guessing. Shown in Live Chat's side panel.
//
// It reads the same records the background jobs act on:
//   journeys (drip sequences)  wa_sequence_enrollments + steps
//   chatbot flow               wa_flow_sessions (keyed by chat id)
//   AI follow-up               the rules in followups.ts, explained per chat
//   review request             wa_review_requests still queued
//   unpaid-order reminder      unpaid-orders.ts, when switched on
// Each explanation mirrors the job's own checks, so "next at 4:30" means the
// job really would act then (give or take its 5-minute schedule).

import { db } from "./supabase";
import { tdb } from "./tenantdb";
import { followupConfig, FOLLOWUP_SAFE_WINDOW_MS } from "./followups";
import { noteStopReason } from "./sequences";
import { currentFlowSession, endSession } from "./flowengine";
import { isOptedOutStrict } from "./store";
import { getWorkSettings } from "./work-settings";
import type { WorkViewer } from "./tasks";

export type AutomationKind = "journey" | "flow" | "ai_followup" | "review_request" | "payment_reminder";
export type AutomationState = "running" | "waiting" | "stopped" | "finished" | "off";

export interface Automation {
  key: string;
  kind: AutomationKind;
  title: string;
  state: AutomationState;
  /** What happens next, and when (null when nothing is scheduled). */
  next: { at: string | null; what: string } | null;
  /** Why it's in this state, in plain words. */
  why: string;
  /** When true, `stop` can be called with this key. */
  canStop: boolean;
  stoppedAt?: string | null;
  stoppedBy?: string | null;
}

type Chat = {
  id: string; phone: string; platform: string; channel_id: string | null; status: string; bot_enabled: boolean | null;
  last_inbound_at: string | null; last_outbound_at: string | null; followup_count: number | null; last_followup_at: string | null;
  bot_resumed_at?: string | null;
};

const fmt = (iso: string) => new Date(iso).toISOString();

/** The chat, if this viewer may see it (team-scoped viewers see only their numbers). */
export async function visibleChat(v: WorkViewer, conversationId: string): Promise<Chat | null> {
  const { data } = await db().from("wa_conversations").select("*").eq("tenant_id", v.tenantId).eq("id", conversationId).maybeSingle();
  const c = data as Chat | null;
  if (!c) return null;
  if (v.allowed && !v.allowed.includes(c.channel_id ?? "")) return null;
  return c;
}

/** Explain the AI follow-up for this chat the way drainAiFollowups decides it. Pure. */
export function explainFollowup(c: Chat, cfg: { enabled: boolean; delayMinutes: number; maxAttempts: number }, ctx: { inFlow: boolean; onJourney: boolean; optedOut: boolean; now: number }): Automation {
  const base = { key: `ai_followup:${c.id}`, kind: "ai_followup" as const, title: "AI follow-up" };
  const attempts = c.followup_count ?? 0;
  const off = (why: string): Automation => ({ ...base, state: "off", next: null, why, canStop: false });
  const waiting = (why: string): Automation => ({ ...base, state: "waiting", next: null, why, canStop: attempts < cfg.maxAttempts });
  if (!cfg.enabled) return off("AI follow-ups are switched off for your workspace.");
  if (c.bot_enabled === false) return off("A person has taken over this chat, so the AI won't follow up.");
  if (!["active", "escalated"].includes(c.status)) return off("This chat is closed.");
  if (ctx.optedOut) return off("The customer opted out of messages.");
  if (attempts >= cfg.maxAttempts) {
    return { ...base, state: "finished", next: null, canStop: false,
      why: attempts > cfg.maxAttempts ? "Stopped for this chat until the customer writes again." : `Sent ${attempts} follow-up${attempts === 1 ? "" : "s"} (the most allowed). Starts again if the customer writes.` };
  }
  if (!c.last_outbound_at || !c.last_inbound_at || Date.parse(c.last_inbound_at) >= Date.parse(c.last_outbound_at)) {
    return waiting("The customer wrote last, so nothing to follow up yet.");
  }
  if (ctx.now - Date.parse(c.last_inbound_at) > FOLLOWUP_SAFE_WINDOW_MS) return off("Outside WhatsApp's 24-hour window, so the AI can't follow up.");
  if (ctx.inFlow) return waiting("A chatbot flow is running here; it sends its own reminders.");
  if (ctx.onJourney) return waiting("A journey is running for this customer, so the AI stays quiet.");
  if (c.bot_resumed_at && Date.parse(c.last_inbound_at) <= Date.parse(c.bot_resumed_at)) return waiting("The AI came back on by itself, so it answers but won't nudge first.");
  const anchor = c.last_followup_at && Date.parse(c.last_followup_at) > Date.parse(c.last_outbound_at) ? c.last_followup_at : c.last_outbound_at;
  const at = new Date(Date.parse(anchor) + cfg.delayMinutes * 60_000).toISOString();
  const windowEnds = Date.parse(c.last_inbound_at) + FOLLOWUP_SAFE_WINDOW_MS;
  if (Date.parse(at) > windowEnds) return off("The next follow-up would fall outside WhatsApp's 24-hour window, so none will be sent.");
  return { ...base, state: "running", canStop: true, why: `Follow-up ${attempts + 1} of ${cfg.maxAttempts}, if the customer hasn't replied by then.`, next: { at, what: "The AI sends a short follow-up" } };
}

export async function customerAutomations(v: WorkViewer, conversationId: string, now: number = Date.now()): Promise<{ automations: Automation[] } | null> {
  const c = await visibleChat(v, conversationId);
  if (!c) return null;
  const out: Automation[] = [];

  // Journeys: what's running, plus what stopped or finished in the last 30 days.
  const since = new Date(now - 30 * 86_400_000).toISOString();
  const { data: enr } = await tdb(v.tenantId).from("wa_sequence_enrollments").select("*").eq("phone", c.phone).order("updated_at", { ascending: false }).limit(30);
  const rows = ((enr ?? []) as unknown as Record<string, unknown>[]).filter(e => e.status === "active" || String(e.updated_at ?? e.created_at ?? "") >= since);
  const seqIds = [...new Set(rows.map(e => e.sequence_id as string))];
  const [{ data: seqs }, { data: steps }] = seqIds.length ? await Promise.all([
    tdb(v.tenantId).from("wa_sequences").select("id,name,active").in("id", seqIds),
    tdb(v.tenantId).from("wa_sequence_steps").select("sequence_id,step_index").in("sequence_id", seqIds),
  ]) : [{ data: [] }, { data: [] }];
  const names = new Map(((seqs ?? []) as unknown as { id: string; name: string }[]).map(s => [s.id, s.name]));
  const stepCount = new Map<string, number>();
  for (const s of (steps ?? []) as unknown as { sequence_id: string }[]) stepCount.set(s.sequence_id, (stepCount.get(s.sequence_id) ?? 0) + 1);
  for (const e of rows) {
    const total = stepCount.get(e.sequence_id as string) ?? 0;
    const step = (e.current_step as number) ?? 0;
    const title = `Journey: ${names.get(e.sequence_id as string) ?? "a journey"}`;
    const key = `journey:${e.id}`;
    if (e.status === "active") {
      out.push({ key, kind: "journey", title, state: "running", canStop: true,
        next: e.next_run_at ? { at: fmt(e.next_run_at as string), what: `Step ${step + 1}${total ? ` of ${total}` : ""} is sent` } : null,
        why: e.last_error ? `Last attempt failed: ${e.last_error}` : `On step ${step + 1}${total ? ` of ${total}` : ""}.` });
    } else {
      const reason = (e.stop_reason as string | null) ?? (e.status === "completed" ? "Every step was sent." : e.status === "failed" ? `Failed: ${e.last_error ?? "unknown error"}` : e.last_error ? `Stopped: ${e.last_error}` : "Stopped (no reason was recorded).");
      out.push({ key, kind: "journey", title, state: e.status === "completed" ? "finished" : "stopped", canStop: false, next: null, why: reason,
        stoppedAt: (e.stopped_at as string | null) ?? (e.updated_at as string | null) ?? null, stoppedBy: (e.stopped_by as string | null) ?? null });
    }
  }

  // Chatbot flow in progress (sessions are keyed by chat id).
  const session = await currentFlowSession(c.id, v.tenantId).catch(() => null);
  if (session) {
    const { data: flow } = await tdb(v.tenantId).from("wa_flows").select("name").eq("id", session.flowId).maybeSingle();
    out.push({ key: `flow:${c.id}`, kind: "flow", title: `Chatbot flow: ${(flow as { name?: string } | null)?.name ?? "a flow"}`, state: "waiting", canStop: true,
      next: { at: null, what: "Continues when the customer answers" }, why: `Waiting for the customer at step “${session.currentNode}”.` });
  }

  // AI follow-up, explained by the job's own rules.
  const [cfg, optedOut] = await Promise.all([
    followupConfig(v.tenantId).catch(() => ({ enabled: false, delayMinutes: 60, maxAttempts: 1 })),
    isOptedOutStrict(c.phone, v.tenantId).catch(() => false),
  ]);
  out.push(explainFollowup(c, cfg, { inFlow: !!session, onJourney: rows.some(e => e.status === "active"), optedOut, now }));

  // Review request still queued.
  const { data: rr, error: rrErr } = await tdb(v.tenantId).from("wa_review_requests").select("id,status,send_after,source").eq("phone", c.phone).in("status", ["scheduled", "sending"]).limit(5);
  for (const r of ((rrErr ? [] : rr) ?? []) as unknown as { id: string; status: string; send_after: string | null; source: string | null }[]) {
    out.push({ key: `review_request:${r.id}`, kind: "review_request", title: "Google review request", state: "waiting", canStop: r.status === "scheduled",
      next: { at: r.send_after, what: "Asks the customer for a Google review" }, why: r.source === "manual" ? "Sent by a teammate." : `Queued after ${r.source === "order" ? "a paid order" : "a completed service"}.` });
  }

  // Payment reminder for an unpaid order, when the workspace has it on.
  const work = await getWorkSettings(v.tenantId);
  if (work.unpaidReminder.enabled) {
    const { data: orders, error } = await db().from("wa_orders").select("id,created_at,payment_url").eq("tenant_id", v.tenantId).eq("phone", c.phone)
      .eq("status", "pending").is("unpaid_reminded_at", null).gte("created_at", new Date(now - 20 * 3_600_000).toISOString()).limit(3);
    for (const o of ((error ? [] : orders) ?? []) as { id: string; created_at: string; payment_url: string | null }[]) {
      out.push({ key: `payment_reminder:${o.id}`, kind: "payment_reminder", title: `Payment reminder — order ${o.id.slice(0, 8)}`,
        state: o.payment_url ? "waiting" : "off", canStop: !!o.payment_url,
        next: o.payment_url ? { at: new Date(Date.parse(o.created_at) + work.unpaidReminder.afterMinutes * 60_000).toISOString(), what: "Sends the payment link once, if still unpaid" } : null,
        why: o.payment_url ? "Only inside WhatsApp's 24-hour window." : "No payment link was saved for this order, so no reminder." });
    }
  }

  const rank: Record<AutomationState, number> = { running: 0, waiting: 1, stopped: 2, finished: 3, off: 4 };
  out.sort((a, b) => rank[a.state] - rank[b.state] || (a.next?.at ?? "9").localeCompare(b.next?.at ?? "9"));
  return { automations: out };
}

/** Stop one automation for this customer, recording who stopped it. */
export async function stopAutomation(v: WorkViewer, conversationId: string, key: string): Promise<{ ok?: true; error?: string; status?: number }> {
  const c = await visibleChat(v, conversationId);
  if (!c) return { error: "Chat not found", status: 404 };
  const [kind, ref] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
  const who = v.user.name || v.user.email;
  if (kind === "journey") {
    const { data } = await tdb(v.tenantId).from("wa_sequence_enrollments").update({ status: "stopped", updated_at: new Date().toISOString() })
      .eq("id", ref).eq("phone", c.phone).eq("status", "active").select("id");
    if (!data?.length) return { error: "That journey isn't running any more.", status: 409 };
    await noteStopReason(v.tenantId, { ids: [ref] }, `Stopped by ${who}`, v.user.email.toLowerCase());
    return { ok: true };
  }
  if (kind === "flow") {
    if (ref !== c.id) return { error: "That flow isn't running here.", status: 409 };
    await endSession(c.id);
    return { ok: true };
  }
  if (kind === "ai_followup") {
    // Past the maximum: the job skips it. A customer message resets the count
    // (touchInbound), so this pauses follow-ups until they next write.
    const cfg = await followupConfig(v.tenantId);
    await db().from("wa_conversations").update({ followup_count: cfg.maxAttempts + 1 }).eq("tenant_id", v.tenantId).eq("id", c.id);
    return { ok: true };
  }
  if (kind === "review_request") {
    const { data } = await tdb(v.tenantId).from("wa_review_requests").update({ status: "cancelled", detail: `Cancelled by ${who}` })
      .eq("id", ref).eq("phone", c.phone).eq("status", "scheduled").select("id");
    return data?.length ? { ok: true } : { error: "That review request was already sent or cancelled.", status: 409 };
  }
  if (kind === "payment_reminder") {
    // Marking it as handled is exactly what the reminder job checks; nothing is sent.
    const { data } = await db().from("wa_orders").update({ unpaid_reminded_at: new Date().toISOString() })
      .eq("tenant_id", v.tenantId).eq("id", ref).eq("phone", c.phone).is("unpaid_reminded_at", null).select("id");
    return data?.length ? { ok: true } : { error: "That reminder was already sent or stopped.", status: 409 };
  }
  return { error: "Unknown automation", status: 400 };
}
