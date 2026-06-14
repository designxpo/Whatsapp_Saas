// Sequences (drip) — timed, multi-step automations. The backbone for follow-up
// nurture AND cart recovery AND post-purchase. Enrollment is created by any
// event (keyword, opt-in, story_reply, tag, cart_abandoned…); the cron advances
// due enrollments through the steps.
//
// Compliance: Instagram steps only send inside the 24h window (instagram.ts
// enforces it). WhatsApp steps outside the window must use an approved template
// (action.type = 'template'); session text/media only land inside the window.

import { db } from "./supabase";
import { getChannel } from "./channels";
import { sendText, sendTemplateSingle, sendMedia } from "./whatsapp";
import { sendIgMessage } from "./instagram";
import { getConversationByPhone } from "./store";

export type SequenceTriggerKind =
  | "manual" | "keyword" | "tag_added" | "opt_in" | "story_reply"
  | "comment" | "cart_abandoned" | "order_placed" | "ad_referral";

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
  triggerValue: string | null; active: boolean;
}

function mapSeq(r: Record<string, unknown>): Sequence {
  return {
    id: r.id as string, name: r.name as string, channelId: (r.channel_id as string | null) ?? null,
    platform: (r.platform as Sequence["platform"]) ?? "whatsapp",
    triggerKind: (r.trigger_kind as SequenceTriggerKind) ?? "manual",
    triggerValue: (r.trigger_value as string | null) ?? null, active: (r.active as boolean) ?? true,
  };
}

// ── CRUD ──────────────────────────────────────────────────────────────────────
export async function listSequences(): Promise<Sequence[]> {
  const { data } = await db().from("wa_sequences").select("*").order("created_at", { ascending: false });
  return (data ?? []).map(r => mapSeq(r as Record<string, unknown>));
}

export async function getSequence(id: string): Promise<Sequence | null> {
  const { data } = await db().from("wa_sequences").select("*").eq("id", id).maybeSingle();
  return data ? mapSeq(data as Record<string, unknown>) : null;
}

export async function createSequence(p: { name: string; channelId?: string | null; platform?: "whatsapp" | "instagram"; triggerKind?: SequenceTriggerKind; triggerValue?: string | null }): Promise<Sequence> {
  const { data, error } = await db().from("wa_sequences").insert({
    name: p.name.trim(), channel_id: p.channelId ?? null, platform: p.platform ?? "whatsapp",
    trigger_kind: p.triggerKind ?? "manual", trigger_value: p.triggerValue ?? null,
  }).select().single();
  if (error) throw error;
  return mapSeq(data as Record<string, unknown>);
}

export async function updateSequence(id: string, p: Partial<{ name: string; channelId: string | null; platform: "whatsapp" | "instagram"; triggerKind: SequenceTriggerKind; triggerValue: string | null; active: boolean }>): Promise<void> {
  const row: Record<string, unknown> = {};
  if (p.name !== undefined) row.name = p.name.trim();
  if (p.channelId !== undefined) row.channel_id = p.channelId;
  if (p.platform !== undefined) row.platform = p.platform;
  if (p.triggerKind !== undefined) row.trigger_kind = p.triggerKind;
  if (p.triggerValue !== undefined) row.trigger_value = p.triggerValue;
  if (p.active !== undefined) row.active = p.active;
  if (Object.keys(row).length) { const { error } = await db().from("wa_sequences").update(row).eq("id", id); if (error) throw error; }
}

export async function deleteSequence(id: string): Promise<void> {
  await db().from("wa_sequences").delete().eq("id", id);   // steps + enrollments cascade
}

export async function setSequenceSteps(sequenceId: string, steps: { delayMinutes: number; action: SequenceStepAction }[]): Promise<void> {
  await db().from("wa_sequence_steps").delete().eq("sequence_id", sequenceId);
  if (!steps.length) return;
  const rows = steps.map((s, i) => ({ sequence_id: sequenceId, step_index: i, delay_minutes: Math.max(0, Math.round(s.delayMinutes)), action: s.action }));
  const { error } = await db().from("wa_sequence_steps").insert(rows);
  if (error) throw error;
}

export async function getSequenceSteps(sequenceId: string): Promise<SequenceStep[]> {
  const { data } = await db().from("wa_sequence_steps").select("*").eq("sequence_id", sequenceId).order("step_index");
  return (data ?? []).map(r => ({
    id: r.id as string, stepIndex: r.step_index as number, delayMinutes: (r.delay_minutes as number) ?? 0,
    action: (r.action as SequenceStepAction) ?? { type: "text" },
  }));
}

// Resolve the active sequence bound to an event (keyword/story_reply/etc).
export async function getSequenceByTrigger(kind: SequenceTriggerKind, value?: string | null): Promise<Sequence | null> {
  let q = db().from("wa_sequences").select("*").eq("trigger_kind", kind).eq("active", true);
  if (value) q = q.eq("trigger_value", value);
  const { data } = await q.order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data ? mapSeq(data as Record<string, unknown>) : null;
}

// ── Enrollment ──────────────────────────────────────────────────────────────
export async function enroll(sequenceId: string, p: { phone: string; platform?: "whatsapp" | "instagram"; conversationId?: string | null }): Promise<void> {
  const steps = await getSequenceSteps(sequenceId);
  if (!steps.length) return;
  const firstDelayMs = Math.max(0, steps[0].delayMinutes) * 60_000;
  const nextRun = new Date(Date.now() + firstDelayMs).toISOString();
  await db().from("wa_sequence_enrollments").upsert({
    sequence_id: sequenceId, phone: p.phone, platform: p.platform ?? "whatsapp",
    conversation_id: p.conversationId ?? null, current_step: 0, status: "active",
    next_run_at: nextRun, updated_at: new Date().toISOString(),
  }, { onConflict: "sequence_id,phone" });
}

export async function stopEnrollment(sequenceId: string, phone: string): Promise<void> {
  await db().from("wa_sequence_enrollments").update({ status: "stopped", updated_at: new Date().toISOString() })
    .eq("sequence_id", sequenceId).eq("phone", phone);
}

// ── Execution ─────────────────────────────────────────────────────────────────
async function executeStep(seq: Sequence, enr: Record<string, unknown>, step: SequenceStep): Promise<{ ok: boolean; error?: string }> {
  const channel = seq.channelId ? (await getChannel(seq.channelId)) ?? undefined : undefined;
  const phone = enr.phone as string;
  const a = step.action;

  if ((enr.platform as string) === "instagram") {
    if (!channel?.igUserId) return { ok: false, error: "Instagram channel missing" };
    if (a.type !== "text" || !a.text) return { ok: true };   // IG drip supports text only
    const conv = await getConversationByPhone(phone);
    const r = await sendIgMessage({ igUserId: channel.igUserId, token: channel.token }, phone, a.text, { lastInboundAt: conv?.lastInboundAt ?? null });
    return { ok: r.ok, error: r.error };
  }

  // WhatsApp — channel (Channel) is assignable to ChannelCreds; undefined → env default.
  if (a.type === "text" && a.text) { const r = await sendText(phone, a.text, channel); return { ok: !r.error, error: r.error }; }
  if (a.type === "template" && a.templateName) { const r = await sendTemplateSingle(phone, a.templateName, a.languageCode ?? "en_US", a.params ?? [], channel); return { ok: !r.error, error: r.error }; }
  if (a.type === "media" && a.url) { const r = await sendMedia(phone, a.mediaKind ?? "image", a.url, a.caption, channel); return { ok: !r.error, error: r.error }; }
  return { ok: true };   // empty/unknown step → no-op, just advance
}

// Drain due enrollments — called by the cron. Advances each one step; failures
// are recorded but still advance (so a bad step never wedges the sequence).
export async function drainSequences(max = 100): Promise<number> {
  const now = new Date().toISOString();
  const { data } = await db().from("wa_sequence_enrollments")
    .select("*").eq("status", "active").lte("next_run_at", now).order("next_run_at").limit(max);

  let processed = 0;
  for (const enr of (data ?? []) as Record<string, unknown>[]) {
    try {
      const seq = await getSequence(enr.sequence_id as string);
      if (!seq || !seq.active) { await db().from("wa_sequence_enrollments").update({ status: "stopped" }).eq("id", enr.id as string); continue; }
      const steps = await getSequenceSteps(seq.id);
      const idx = (enr.current_step as number) ?? 0;
      const step = steps[idx];
      if (!step) { await db().from("wa_sequence_enrollments").update({ status: "completed", updated_at: new Date().toISOString() }).eq("id", enr.id as string); continue; }

      const res = await executeStep(seq, enr, step);

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
