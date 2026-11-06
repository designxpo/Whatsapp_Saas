// Workspace settings behind the Today view.
//
// replyTargetMinutes — how long a customer may wait for a person before the
//   chat counts as overdue. Before this, "waiting" was a fixed 2 minutes
//   (UNANSWERED_AFTER_MS), which says when the AI hands over, not when a
//   person is late.
// alertEmails — email the people responsible when a chat goes overdue or a
//   task falls due. Off until an admin turns it on: a new setting must not
//   start mailing a team that never asked for it.
// alertHours — emails wait for working hours (business time zone) so an
//   11 pm message doesn't page anyone; the chat still shows as overdue.
// unpaidReminder — one WhatsApp reminder with the pay link for an order left
//   unpaid. Off by default; it messages customers.
// integrationEmails — tell admins when a connection breaks (number restricted,
//   Instagram/Google access lost, deliveries failing, a payment with no order).
//   On by default: it's a service notice about their own account, sent once
//   per problem, and they can switch it off.

import { getTenantSetting, setTenantSetting } from "./store";

export interface WorkSettings {
  replyTargetMinutes: number;
  alertEmails: boolean;
  alertHours: { start: number; end: number } | null;
  unpaidReminder: { enabled: boolean; afterMinutes: number };
  integrationEmails: boolean;
}

export const WORK_SETTINGS_KEY = "work_settings";

export const DEFAULT_WORK_SETTINGS: WorkSettings = {
  replyTargetMinutes: 15,
  alertEmails: false,
  alertHours: { start: 9, end: 20 },
  unpaidReminder: { enabled: false, afterMinutes: 60 },
  integrationEmails: true,
};

const clamp = (n: unknown, lo: number, hi: number, fb: number) => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fb;
};

export function normalizeWorkSettings(raw: unknown): WorkSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_WORK_SETTINGS;
  const hours = r.alertHours === null ? null : (() => {
    const h = (r.alertHours && typeof r.alertHours === "object" ? r.alertHours : d.alertHours) as Record<string, unknown>;
    const start = clamp(h.start, 0, 23, 9), end = clamp(h.end, 1, 24, 20);
    return end > start ? { start, end } : d.alertHours;
  })();
  const u = (r.unpaidReminder && typeof r.unpaidReminder === "object" ? r.unpaidReminder : {}) as Record<string, unknown>;
  return {
    replyTargetMinutes: clamp(r.replyTargetMinutes, 1, 24 * 60, d.replyTargetMinutes),
    alertEmails: r.alertEmails === true,
    alertHours: hours,
    unpaidReminder: {
      enabled: u.enabled === true,
      // At least 15 minutes, and under a day so it still lands inside WhatsApp's 24-hour window.
      afterMinutes: clamp(u.afterMinutes, 15, 20 * 60, d.unpaidReminder.afterMinutes),
    },
    integrationEmails: r.integrationEmails !== false,
  };
}

export async function getWorkSettings(tenantId: string): Promise<WorkSettings> {
  try { return normalizeWorkSettings(await getTenantSetting<unknown>(tenantId, WORK_SETTINGS_KEY, {})); }
  catch { return DEFAULT_WORK_SETTINGS; }
}

export async function saveWorkSettings(tenantId: string, patch: unknown): Promise<WorkSettings> {
  const current = await getWorkSettings(tenantId);
  const p = (patch && typeof patch === "object" ? patch : {}) as Record<string, unknown>;
  const next = normalizeWorkSettings({
    ...current, ...p,
    unpaidReminder: { ...current.unpaidReminder, ...((p.unpaidReminder as object) ?? {}) },
  });
  await setTenantSetting(tenantId, WORK_SETTINGS_KEY, next);
  return next;
}
