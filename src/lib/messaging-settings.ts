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
