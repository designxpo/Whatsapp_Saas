import { describe, it, expect, vi, beforeEach } from "vitest";

// Per-tenant stale-escalation sweep. Beyond the behaviour itself, the thing that
// MUST hold in a multi-tenant app: every read, write, run-window and reset is
// scoped to one tenant. store.ts's getSetting/setSetting silently target
// DEFAULT_TENANT_ID, so using them here would give every tenant the default
// tenant's toggle and share ONE run-window between all of them — the first
// tenant swept would consume it for everyone.
const h = vi.hoisted(() => ({
  // settings[tenantId][key]
  settings: {} as Record<string, Record<string, unknown>>,
  resetCalls: [] as { tenantId: string; days: number; limit: number }[],
  resetReturns: {} as Record<string, { id: string; phone: string; name: string }[]>,
  staleCounts: {} as Record<string, number>,
  tenants: [] as { id: string }[],
  activity: [] as { action: string; detail: string }[],
  globalSettingUsed: false,
  throwFor: new Set<string>(),   // tenants whose reset should blow up
}));

vi.mock("../store", () => ({
  // If anything reaches for the non-tenant variants, the test suite should know.
  getSetting: async () => { h.globalSettingUsed = true; return undefined; },
  setSetting: async () => { h.globalSettingUsed = true; },
  getTenantSetting: async (t: string, k: string, fallback: unknown) => {
    const v = h.settings[t]?.[k];
    return v === undefined ? fallback : v;
  },
  setTenantSetting: async (t: string, k: string, v: unknown) => {
    h.settings[t] = { ...(h.settings[t] ?? {}), [k]: v };
  },
  countStaleEscalations: async (t: string) => h.staleCounts[t] ?? 0,
  resetStaleEscalations: async (tenantId: string, days: number, limit: number) => {
    h.resetCalls.push({ tenantId, days, limit });
    if (h.throwFor.has(tenantId)) throw new Error(`db failure for ${tenantId}`);
    return h.resetReturns[tenantId] ?? [];
  },
}));
vi.mock("../supabase", () => ({
  db: () => ({ from: () => ({ select: () => ({ in: () => Promise.resolve({ data: h.tenants, error: null }) }) }) }),
}));
vi.mock("../team", () => ({
  logActivity: (_a: unknown, action: string, detail: string) => { h.activity.push({ action, detail }); },
}));

import {
  sweepTenantEscalations, drainEscalationSweeps, getEscalationSweep,
  setEscalationSweep, escalationSweepStatus, ESCALATION_SWEEP_DEFAULTS,
} from "../escalations";

const DAY = 86_400_000;
const NOW = new Date("2026-08-06T09:00:00.000Z").getTime();
const A = "tenant-a", B = "tenant-b";
const enable = (t: string, patch: Record<string, unknown> = {}) => {
  h.settings[t] = { ...(h.settings[t] ?? {}), escalation_sweep: { enabled: true, staleAfterDays: 30, everyDays: 30, ...patch } };
};

beforeEach(() => {
  h.settings = {}; h.resetCalls = []; h.resetReturns = {}; h.staleCounts = {};
  h.tenants = []; h.activity = []; h.globalSettingUsed = false; h.throwFor = new Set();
});

describe("tenant isolation", () => {
  it("never touches the tenant-agnostic getSetting/setSetting", async () => {
    enable(A);
    await sweepTenantEscalations(A, { now: NOW });
    await escalationSweepStatus(A);
    await setEscalationSweep(A, { enabled: true });
    expect(h.globalSettingUsed).toBe(false);
  });

  it("one tenant enabling it does not enable it for anyone else", async () => {
    enable(A);
    expect((await getEscalationSweep(A)).enabled).toBe(true);
    expect((await getEscalationSweep(B)).enabled).toBe(false);
  });

  it("each tenant has its OWN run window — one sweeping doesn't block another", async () => {
    enable(A); enable(B);
    await sweepTenantEscalations(A, { now: NOW });      // A claims its window
    const rb = await sweepTenantEscalations(B, { now: NOW });
    expect(rb.ran).toBe(true);                          // B unaffected
    expect((await sweepTenantEscalations(A, { now: NOW + 60_000 })).ran).toBe(false);
  });

  it("passes the tenant id down to the reset so it can't cross tenants", async () => {
    enable(A, { staleAfterDays: 45 });
    await sweepTenantEscalations(A, { now: NOW });
    expect(h.resetCalls).toEqual([{ tenantId: A, days: 45, limit: 500 }]);
  });

  it("each tenant's own staleness setting is respected", async () => {
    enable(A, { staleAfterDays: 7 });
    enable(B, { staleAfterDays: 90 });
    await sweepTenantEscalations(A, { now: NOW });
    await sweepTenantEscalations(B, { now: NOW });
    expect(h.resetCalls.map(c => c.days)).toEqual([7, 90]);
  });

  it("status reports only this tenant's pending count", async () => {
    enable(A); h.staleCounts[A] = 12; h.staleCounts[B] = 999;
    expect((await escalationSweepStatus(A)).dueNow).toBe(12);
  });
});

describe("configuration", () => {
  it("is OFF by default — a bulk status change must be opted into", async () => {
    expect((await getEscalationSweep(A)).enabled).toBe(false);
    expect(ESCALATION_SWEEP_DEFAULTS.enabled).toBe(false);
  });

  it("rejects a zero/negative value rather than clamping it to 1 day", async () => {
    // Number(null) === 0 and IS finite, so clamping would mean a DAILY sweep
    // resetting chats escalated only yesterday.
    await setEscalationSweep(A, { enabled: true, staleAfterDays: 0, everyDays: -5 });
    const cfg = await getEscalationSweep(A);
    expect(cfg.staleAfterDays).toBe(30);
    expect(cfg.everyDays).toBe(30);
  });

  it("falls back to defaults for null / non-numeric stored values", async () => {
    h.settings[A] = { escalation_sweep: { enabled: true, staleAfterDays: "abc", everyDays: null } };
    const cfg = await getEscalationSweep(A);
    expect(cfg.staleAfterDays).toBe(30);
    expect(cfg.everyDays).toBe(30);
  });

  it("clamps an absurd interval (running too rarely is harmless)", async () => {
    await setEscalationSweep(A, { enabled: true, staleAfterDays: 9999, everyDays: 9999 });
    const cfg = await getEscalationSweep(A);
    expect(cfg.staleAfterDays).toBe(365);
    expect(cfg.everyDays).toBe(365);
  });
});

describe("scheduling and manual runs", () => {
  it("does nothing while disabled — never touches the database", async () => {
    expect(await sweepTenantEscalations(A, { now: NOW })).toEqual({ ran: false, reset: 0, reason: "disabled" });
    expect(h.resetCalls).toHaveLength(0);
  });

  it("honours a custom interval", async () => {
    enable(A, { everyDays: 7 });
    await sweepTenantEscalations(A, { now: NOW });
    expect((await sweepTenantEscalations(A, { now: NOW + 6 * DAY })).ran).toBe(false);
    expect((await sweepTenantEscalations(A, { now: NOW + 7 * DAY })).ran).toBe(true);
  });

  it("'Run now' overrides both the interval AND the off switch", async () => {
    h.settings[A] = { escalation_sweep_last_run: new Date(NOW).toISOString() };   // disabled + just ran
    h.resetReturns[A] = [{ id: "c1", phone: "919876543210", name: "A" }];
    expect(await sweepTenantEscalations(A, { now: NOW + 60_000, force: true })).toEqual({ ran: true, reset: 1 });
    expect(h.activity[0].detail).toContain("[manual run]");
  });
});

describe("cron fan-out", () => {
  it("sweeps only tenants that switched it on, and reports the totals", async () => {
    h.tenants = [{ id: A }, { id: B }];
    enable(A);                       // B stays off
    h.resetReturns[A] = [{ id: "c1", phone: "91987", name: "" }, { id: "c2", phone: "91988", name: "" }];
    expect(await drainEscalationSweeps()).toEqual({ tenants: 1, reset: 2 });
    expect(h.resetCalls.map(c => c.tenantId)).toEqual([A]);
  });

  it("one tenant's failure does not stop the others", async () => {
    h.tenants = [{ id: A }, { id: B }];
    enable(A); enable(B);
    h.throwFor.add(A);                                            // A genuinely blows up
    h.resetReturns[B] = [{ id: "c9", phone: "91999", name: "" }];
    const r = await drainEscalationSweeps();
    expect(h.resetCalls.some(c => c.tenantId === A)).toBe(true);   // A was attempted…
    expect(h.resetCalls.some(c => c.tenantId === B)).toBe(true);   // …and B still ran
    expect(r).toEqual({ tenants: 1, reset: 1 });                   // only B counted
  });

  it("a tenant whose sweep threw still waits for its next window, not the next minute", async () => {
    h.tenants = [{ id: A }];
    enable(A);
    h.throwFor.add(A);
    await drainEscalationSweeps();
    h.throwFor.clear(); h.resetCalls = [];
    await drainEscalationSweeps();                 // one minute later
    expect(h.resetCalls).toHaveLength(0);          // window was claimed before the work
  });

  it("records what it changed, naming the numbers, capped at 10", async () => {
    h.tenants = [{ id: A }];
    enable(A);
    h.resetReturns[A] = Array.from({ length: 25 }, (_, i) => ({ id: `c${i}`, phone: `9198765432${String(i).padStart(2, "0")}`, name: "" }));
    await drainEscalationSweeps();
    expect(h.activity[0].action).toBe("inbox.escalation_sweep");
    expect(h.activity[0].detail).toContain("bot re-enabled");
    expect(h.activity[0].detail).toContain("…");
    expect(h.activity[0].detail.match(/9198765432/g)).toHaveLength(10);
  });

  it("logs nothing when a tenant had nothing stale", async () => {
    h.tenants = [{ id: A }];
    enable(A);
    expect(await drainEscalationSweeps()).toEqual({ tenants: 1, reset: 0 });
    expect(h.activity).toHaveLength(0);
  });
});
