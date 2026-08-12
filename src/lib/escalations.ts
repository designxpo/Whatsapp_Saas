// Stale-escalation sweep — PER TENANT.
//
// Escalated chats accumulate: the AI hands one off, or an agent hits Escalate,
// it gets dealt with, and nobody sets the status back. Months later the
// Escalated filter is a graveyard and the genuinely urgent ones are lost in it.
//
// On a schedule this resets chats escalated for at least `staleAfterDays` back
// to active AND turns the bot back on. Re-enabling matters: escalating alone
// never mutes the bot, but a human replying does — so a chat a human touched has
// the bot off. Flipping only the status would drop it out of the escalated queue
// while leaving the AI silent, i.e. nobody watching and nobody answering. Full
// reset or nothing.
//
// OFF by default per tenant. It changes conversation status in bulk, so it must
// be each tenant's explicit decision, made after previewing what it would touch.
//
// EVERYTHING here is tenant-scoped on purpose. getSetting/setSetting in store.ts
// silently target DEFAULT_TENANT_ID, so using them would give every tenant the
// default tenant's toggle AND share one run-window between all of them — the
// first tenant swept would consume it for everyone. Always the Tenant variants.

import {
  getTenantSetting, setTenantSetting,
  resetStaleEscalations, countStaleEscalations,
} from "./store";
import { db } from "./supabase";
import { logActivity } from "./team";

const SETTING_KEY = "escalation_sweep";
const LAST_RUN_KEY = "escalation_sweep_last_run";
const LAST_COUNT_KEY = "escalation_sweep_last_count";
const MAX_PER_RUN = 500;
const MAX_TENANTS_PER_TICK = 25;   // keeps one cron tick inside its budget

export interface EscalationSweepSetting {
  enabled: boolean;
  staleAfterDays: number;   // only reset chats escalated at least this long
  everyDays: number;        // how often the sweep runs
}
export const ESCALATION_SWEEP_DEFAULTS: EscalationSweepSetting = {
  enabled: false,
  staleAfterDays: 30,
  everyDays: 30,
};

// Anything not a usable positive number falls back to the default rather than
// being clamped up from zero. Number(null) is 0, so clamping would silently turn
// a missing value into "1 day" — i.e. a sweep running daily and resetting chats
// escalated only yesterday. Too-rare is harmless, so the ceiling just clamps.
const clampDays = (v: unknown, fallback: number) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(365, n);
};

export async function getEscalationSweep(tenantId: string): Promise<EscalationSweepSetting> {
  const s = await getTenantSetting<Partial<EscalationSweepSetting>>(tenantId, SETTING_KEY, {});
  return {
    enabled: s.enabled === true,   // absent → off
    staleAfterDays: clampDays(s.staleAfterDays, ESCALATION_SWEEP_DEFAULTS.staleAfterDays),
    everyDays: clampDays(s.everyDays, ESCALATION_SWEEP_DEFAULTS.everyDays),
  };
}

export async function setEscalationSweep(tenantId: string, v: Partial<EscalationSweepSetting>): Promise<void> {
  await setTenantSetting(tenantId, SETTING_KEY, {
    enabled: v.enabled === true,
    staleAfterDays: clampDays(v.staleAfterDays, ESCALATION_SWEEP_DEFAULTS.staleAfterDays),
    everyDays: clampDays(v.everyDays, ESCALATION_SWEEP_DEFAULTS.everyDays),
  });
}

export interface EscalationSweepStatus extends EscalationSweepSetting {
  lastRunAt: string | null;
  lastResetCount: number | null;
  dueNow: number;        // how many WOULD be reset if it ran right now
  nextRunAt: string | null;
}

// Everything one tenant's settings card needs, including a dry-run count so
// enabling this is an informed decision rather than a leap.
export async function escalationSweepStatus(tenantId: string): Promise<EscalationSweepStatus> {
  const cfg = await getEscalationSweep(tenantId);
  const lastRunAt = (await getTenantSetting<string>(tenantId, LAST_RUN_KEY, "")) || null;
  const lastResetCount = await getTenantSetting<number | null>(tenantId, LAST_COUNT_KEY, null);
  const dueNow = await countStaleEscalations(tenantId, cfg.staleAfterDays).catch(() => 0);
  return {
    ...cfg,
    lastRunAt,
    lastResetCount,
    dueNow,
    nextRunAt: lastRunAt ? new Date(new Date(lastRunAt).getTime() + cfg.everyDays * 86_400_000).toISOString() : null,
  };
}

export interface EscalationSweepResult {
  ran: boolean;      // false = disabled, or not due yet
  reset: number;
  reason?: "disabled" | "not_due";
}

// One tenant. `force` runs regardless of the interval and the enabled flag (the
// settings card's "Run now") — a manual run is an explicit human action.
export async function sweepTenantEscalations(
  tenantId: string,
  opts: { now?: number; force?: boolean } = {},
): Promise<EscalationSweepResult> {
  const now = opts.now ?? Date.now();
  const cfg = await getEscalationSweep(tenantId);
  if (!cfg.enabled && !opts.force) return { ran: false, reset: 0, reason: "disabled" };

  if (!opts.force) {
    const last = await getTenantSetting<string>(tenantId, LAST_RUN_KEY, "");
    if (last && now - new Date(last).getTime() < cfg.everyDays * 86_400_000) {
      return { ran: false, reset: 0, reason: "not_due" };
    }
  }

  // Stamp BEFORE the work: if this throws, that tenant waits for its next
  // window instead of retrying every minute for a month.
  await setTenantSetting(tenantId, LAST_RUN_KEY, new Date(now).toISOString());

  const reset = await resetStaleEscalations(tenantId, cfg.staleAfterDays, MAX_PER_RUN);
  await setTenantSetting(tenantId, LAST_COUNT_KEY, reset.length);
  if (reset.length) {
    // Audit trail — a status change nobody made by hand should be explainable.
    logActivity(null, "inbox.escalation_sweep",
      `reset ${reset.length} chat(s) escalated ${cfg.staleAfterDays}+ days to active (bot re-enabled)${opts.force ? " [manual run]" : ""}: ${reset.slice(0, 10).map(r => r.phone).join(", ")}${reset.length > 10 ? "…" : ""}`);
  }
  return { ran: true, reset: reset.length };
}

// Cron entry point: every live tenant that has switched the sweep on. One
// tenant's failure must not stop the others, so each is isolated.
export async function drainEscalationSweeps(): Promise<{ tenants: number; reset: number }> {
  const { data: tenants } = await db().from("tenants").select("id").in("status", ["trialing", "active"]);
  let swept = 0, reset = 0;
  for (const t of (tenants ?? []).slice(0, MAX_TENANTS_PER_TICK)) {
    const tenantId = (t as { id: string }).id;
    try {
      const r = await sweepTenantEscalations(tenantId);
      if (r.ran) { swept++; reset += r.reset; }
    } catch (e) {
      console.error("[escalationsweep]", tenantId, e);
    }
  }
  return { tenants: swept, reset };
}
