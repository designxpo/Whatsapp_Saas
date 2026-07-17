// Welcome + away message settings — shared by the settings API and the webhook.

import { getTenantSetting, setTenantSetting } from "./store";
import { DEFAULT_TENANT_ID } from "./auth";

// ── AI auto-replies master switch (per tenant) ────────────────────────────────
// ONE tenant-wide toggle that silences the AI assistant everywhere — WhatsApp,
// Instagram, Messenger, web chat AND the AI follow-up nudges. Chatbot flows,
// welcome/away messages and human agents keep working. Default ON. Only a human
// flips this (the AI/system never disables itself).
export async function isAiEnabled(tenantId: string = DEFAULT_TENANT_ID): Promise<boolean> {
  return (await getTenantSetting<{ enabled?: boolean }>(tenantId, "ai_replies", {})).enabled !== false;
}
export async function setAiEnabled(enabled: boolean, tenantId: string = DEFAULT_TENANT_ID): Promise<void> {
  await setTenantSetting(tenantId, "ai_replies", { enabled: enabled === true });
}

// ── Off-script nudge (per tenant) ─────────────────────────────────────────────
// What the bot says when a chatbot flow is waiting on a menu (buttons/list) and
// the visitor types something that matches no option — without this, an AI-off
// setup goes silent. Several variations rotate across repeated misses so the
// bot doesn't sound robotic; the flow engine caps nudges at 3 per menu, then
// falls back to the old behaviour (AI if enabled, else silence).
export interface FlowNudgeSetting { enabled: boolean; variations: string[] }
export const FLOW_NUDGE_DEFAULTS: string[] = [
  "Sorry, I didn't quite catch that — please tap one of the options above 👆 and I'll take you to the right place.",
  "I'm a guided assistant 🙂 Pick whichever option above fits best and we'll continue from there.",
  "Let's keep it simple — just choose one of the options above 👆 and I'll guide you step by step.",
];
export async function getFlowNudge(tenantId: string = DEFAULT_TENANT_ID): Promise<FlowNudgeSetting> {
  const s = await getTenantSetting<Partial<FlowNudgeSetting>>(tenantId, "flow_nudge", {});
  const variations = (s.variations ?? []).map(v => String(v).trim()).filter(Boolean).slice(0, 6);
  return { enabled: s.enabled !== false, variations: variations.length ? variations : FLOW_NUDGE_DEFAULTS };
}
export async function setFlowNudge(v: FlowNudgeSetting, tenantId: string = DEFAULT_TENANT_ID): Promise<void> {
  const variations = (v.variations ?? []).map(x => String(x).trim().slice(0, 300)).filter(Boolean).slice(0, 6);
  await setTenantSetting(tenantId, "flow_nudge", { enabled: v.enabled === true, variations });
}

export interface WelcomeSetting { enabled: boolean; text: string }
export interface AwaySetting {
  enabled: boolean;
  text: string;
  startHour: number;        // working hours start (0-23), in tzOffsetMinutes timezone
  endHour: number;          // working hours end (exclusive)
  tzOffsetMinutes: number;  // e.g. 330 = IST
}

export const WELCOME_DEFAULT: WelcomeSetting = {
  enabled: false,
  text: "Hi! 👋 Thanks for reaching out. Ask us anything — our assistant replies instantly, and a team member is always close by.",
};

export const AWAY_DEFAULT: AwaySetting = {
  enabled: false,
  text: "Thanks for your message! Our team is available 10:00–19:00 IST. Our AI assistant can still help you right away — just ask your question.",
  startHour: 10,
  endHour: 19,
  tzOffsetMinutes: 330,
};

// All settings are per-tenant: the webhook passes the receiving channel's tenant
// and the settings API passes the signed-in tenant. Defaulting to the platform
// owner only happens for genuinely tenantless callers.
// ── Flow no-reply nudges (default chain) ──────────────────────────────────────
// What a chatbot flow sends when the person goes quiet on a WAITING step and
// the node has no custom reminder chain of its own. Each step's delay counts
// from the PREVIOUS nudge; replying resets the chain. Editable in Settings;
// empty list falls back to the built-ins; disabled = no default nudges at all
// (node-level chains still fire). Wording stays neutral ("reply to this
// message", not "tap an option") — it shows on every waiting node type.
export interface FlowReminderStep { minutes: number; text: string }
export interface FlowRemindersSetting { enabled: boolean; steps: FlowReminderStep[] }
export const FLOW_REMINDER_DEFAULTS: FlowReminderStep[] = [
  { minutes: 10, text: "🔎 Still Have Questions?\nWhenever you're ready, reply to this message and we'll be happy to assist you." },
  { minutes: 60, text: "We're still here to help! 🙂 Reply above to continue — or type \"menu\" to start over." },
];
const cleanReminderSteps = (steps: unknown): FlowReminderStep[] =>
  (Array.isArray(steps) ? steps : [])
    .map(r => ({ minutes: Math.max(1, Math.round(Number((r as { minutes?: unknown })?.minutes ?? 0))) || 0, text: String((r as { text?: unknown })?.text ?? "").trim().slice(0, 500) }))
    .filter(r => r.minutes > 0 && !!r.text)
    .slice(0, 5);
export async function getFlowReminders(tenantId: string = DEFAULT_TENANT_ID): Promise<FlowRemindersSetting> {
  const s = await getTenantSetting<Partial<FlowRemindersSetting>>(tenantId, "flow_default_reminders", {});
  const steps = cleanReminderSteps(s.steps);
  return { enabled: s.enabled !== false, steps: steps.length ? steps : FLOW_REMINDER_DEFAULTS };
}
export async function setFlowReminders(v: FlowRemindersSetting, tenantId: string = DEFAULT_TENANT_ID): Promise<void> {
  await setTenantSetting(tenantId, "flow_default_reminders", { enabled: v.enabled === true, steps: cleanReminderSteps(v.steps) });
}

export async function getWelcomeSetting(tenantId: string = DEFAULT_TENANT_ID): Promise<WelcomeSetting> {
  return { ...WELCOME_DEFAULT, ...(await getTenantSetting<Partial<WelcomeSetting>>(tenantId, "welcome", {})) };
}

export async function getAwaySetting(tenantId: string = DEFAULT_TENANT_ID): Promise<AwaySetting> {
  return { ...AWAY_DEFAULT, ...(await getTenantSetting<Partial<AwaySetting>>(tenantId, "away", {})) };
}

export async function setWelcomeSetting(tenantId: string, value: Partial<WelcomeSetting>): Promise<void> {
  return setTenantSetting(tenantId, "welcome", value);
}

export async function setAwaySetting(tenantId: string, value: Partial<AwaySetting>): Promise<void> {
  return setTenantSetting(tenantId, "away", value);
}

export function isOutsideWorkingHours(s: AwaySetting, now = new Date()): boolean {
  const local = new Date(now.getTime() + s.tzOffsetMinutes * 60000);
  const hour = local.getUTCHours();
  return s.startHour < s.endHour
    ? hour < s.startHour || hour >= s.endHour
    : hour < s.startHour && hour >= s.endHour;   // overnight window (e.g. 22-6)
}
