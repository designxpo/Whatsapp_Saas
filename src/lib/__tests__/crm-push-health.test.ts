import { describe, it, expect, vi, beforeEach } from "vitest";

// The Live Chat status bar answers one question: is chat data actually reaching
// LeadSquared right now?
//
// It has to be the WRITE path, not the read path. In July 2026 LeadSquared kept
// answering lead lookups while rejecting every activity Create — the custom
// activity type had been deactivated, so the event code no longer resolved. The
// settings page said "Connected" for a full day while nothing reached a single
// timeline. lsqHealthCheck() only proves we can READ, so these counters are what
// the bar reads instead.

const h = vi.hoisted(() => ({
  configured: true,
  syncPending: 0,
  syncDead: 0,
  heldSessions: 0,
  flushHealth: null as Record<string, unknown> | null,
  // The oldest HELD row (0074): the durable copy of why a session is stuck.
  oldestHeld: null as { last_error?: string | null; created_at?: string } | null,
  lastUpdate: null as Record<string, unknown> | null,
  lastFilter: "",
  updateShouldFail: false,
}));

// A generic, filter-recording query builder. The queries here are tenant-scoped
// and chain .eq/.in/.gt in whatever order the code needs, so the double resolves
// by TABLE and by the filters it saw instead of pretending to know one shape.
vi.mock("../supabase", () => ({
  db: () => ({
    from(table: string) {
      const f: Record<string, unknown> = {};
      let head = false, isUpdate = false;
      const b: Record<string, unknown> = {
        select: (_c?: string, opts?: { head?: boolean }) => { if (opts?.head) head = true; return b; },
        eq: (k: string, v: unknown) => { f[k] = v; return b; },
        in: () => b,
        gt: (col: string, v: number) => { h.lastFilter = `${col}>${v}`; return b; },
        order: () => b,
        limit: () => Promise.resolve({ data: h.oldestHeld ? [h.oldestHeld] : [], error: null }),
        update: (patch: Record<string, unknown>) => { h.lastUpdate = patch; isUpdate = true; return b; },
        // Only the flush-health row is modelled; any other settings read is "unset".
        maybeSingle: () => Promise.resolve({
          data: table === "wa_settings" && f.key === "crm_session_flush_health" && h.flushHealth ? { value: h.flushHealth } : null,
          error: null,
        }),
        upsert: () => Promise.resolve({ error: null }),
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
          let out: unknown;
          if (isUpdate) {
            out = h.updateShouldFail
              ? { data: null, error: { message: "boom" } }
              : { data: Array.from({ length: h.heldSessions }, (_, i) => ({ id: `s${i}` })), error: null };
          } else if (head) {
            out = { count: table === "wa_crm_sync" ? (f.status === "pending" ? h.syncPending : h.syncDead) : h.heldSessions, error: null };
          } else {
            out = { data: [], error: null };
          }
          return Promise.resolve(out).then(res, rej);
        },
      };
      return b;
    },
  }),
}));

vi.mock("../errors", () => ({ errorMessage: (e: unknown) => String(e) }));

const ENV = { ...process.env };
beforeEach(() => {
  vi.resetModules();
  process.env = { ...ENV };
  if (h.configured) {
    process.env.LSQ_ACCESS_KEY = "a"; process.env.LSQ_SECRET_KEY = "b";
    process.env.LSQ_API_HOST = "https://api-test.leadsquared.com"; process.env.LSQ_ACTIVITY_CODE = "210";
  }
  h.syncPending = 0; h.syncDead = 0; h.heldSessions = 0; h.flushHealth = null; h.oldestHeld = null;
  h.lastUpdate = null; h.lastFilter = ""; h.updateShouldFail = false;
});

const health = async () => (await import("../leadsquared")).crmPushHealth();

describe("everything is landing", () => {
  it("reports ok when nothing is queued and nothing has failed", async () => {
    const r = await health();
    expect(r.state).toBe("ok");
    expect(r.detail).toMatch(/pushed to LeadSquared/i);
  });

  it("surfaces when the last successful push happened", async () => {
    h.flushHealth = { at: "2026-08-27T10:00:00Z", flushed: 3, deferred: 0, lastError: "", lastOkAt: "2026-08-27T10:00:00Z" };
    expect((await health()).lastOkAt).toBe("2026-08-27T10:00:00Z");
  });
});

describe("a backlog is not a failure", () => {
  it("reports syncing, not failing, when work is merely queued", async () => {
    h.syncPending = 12;
    const r = await health();
    expect(r.state).toBe("syncing");
    expect(r.detail).toMatch(/retrying automatically/i);
  });

  it("counts held conversations alongside the queue", async () => {
    h.syncPending = 2; h.heldSessions = 3;
    expect((await health()).detail).toMatch(/5 updates waiting/);
  });

  it("says 'update' not 'updates' for exactly one", async () => {
    h.syncPending = 1;
    expect((await health()).detail).toMatch(/1 update waiting/);
  });
});

describe("the July outage shape — buffered WITH an error behind it", () => {
  it("reports failing and quotes what LeadSquared said", async () => {
    h.heldSessions = 4;
    h.flushHealth = { at: "2026-08-27T10:00:00Z", flushed: 0, deferred: 4, lastError: "Invalid event code", lastOkAt: null };
    const r = await health();
    expect(r.state).toBe("failing");
    expect(r.detail).toContain("Invalid event code");
  });

  it("a failure outranks a backlog — the error is the actionable part", async () => {
    h.syncPending = 500;                       // lots queued …
    h.heldSessions = 2;
    h.flushHealth = { lastError: "MXInvalidActivityException", lastOkAt: null };
    expect((await health()).state).toBe("failing");   // … but this is what matters
  });

  it("held WITHOUT an error is just a backlog, not a failure", async () => {
    h.heldSessions = 3;
    h.flushHealth = { lastError: "", lastOkAt: "2026-08-27T10:00:00Z" };
    expect((await health()).state).toBe("syncing");
  });
});

describe("dead pushes need a person", () => {
  it("reports failing even when nothing is currently held", async () => {
    h.syncDead = 7;
    const r = await health();
    expect(r.state).toBe("failing");
    expect(r.dead).toBe(7);
  });

  it("explains itself when there is no LeadSquared error text to quote", async () => {
    h.syncDead = 1;
    expect((await health()).detail).toMatch(/gave up after repeated failures/i);
  });
});

describe("not configured", () => {
  it("reports off, so the bar can stay out of the way entirely", async () => {
    delete process.env.LSQ_ACCESS_KEY;
    const r = await health();
    expect(r.state).toBe("off");
    expect(r.configured).toBe(false);
  });

  it("makes no database calls at all in that case", async () => {
    delete process.env.LSQ_ACCESS_KEY;
    h.syncDead = 99;                       // would force "failing" if it were read
    expect((await health()).state).toBe("off");
  });
});

// ── Recovery ────────────────────────────────────────────────────────────────
// Reactivating the activity type in LeadSquared fixes the CAUSE, but the held
// conversations are still parked at the slowest backoff tier — 24 hours out,
// because a permanent rejection deliberately stops re-asking every few minutes.
// So without a release the backlog trickles back over a day after the problem
// is already fixed. This is the step that makes the fix take effect now.
describe("releasing held conversations after the CRM is fixed", () => {
  it("makes every held row due immediately and resets its attempt count", async () => {
    h.heldSessions = 159;
    const { retryHeldCrmSessions } = await import("../leadsquared");
    const r = await retryHeldCrmSessions();
    expect(r.released).toBe(159);
    // Due-now must be OLDER than the quiet window, since last_message_at
    // doubles as both the quiet marker and the backoff deadline.
    expect(h.lastUpdate?.attempts).toBe(0);
    expect(new Date(h.lastUpdate?.last_message_at as string).getTime()).toBeLessThan(Date.now() - 10 * 60_000);
  });

  it("only touches rows that have actually failed", async () => {
    h.heldSessions = 3;
    const { retryHeldCrmSessions } = await import("../leadsquared");
    await retryHeldCrmSessions();
    expect(h.lastFilter).toBe("attempts>0");
  });

  it("reports 0 rather than throwing when the update fails", async () => {
    h.updateShouldFail = true;
    const { retryHeldCrmSessions } = await import("../leadsquared");
    await expect(retryHeldCrmSessions()).resolves.toEqual({ released: 0 });
  });
});

// ── The 2 Sep shape: rows stuck for a week, error string blanked ──────────────
//
// wa_crm_session recorded `attempts` but not WHY, and the only copy of the
// reason lived in crm_session_flush_health.lastError — a single row rewritten by
// every flush tick that had work. So one successful push for a fresh lead wiped
// the explanation for nine sessions held since 26 Aug (activity type 210 had
// been deactivated), and both health surfaces then reported no failure.
//
// Observed live: the Settings panel showed "timeline pushes are FAILING — 9
// conversation(s) buffered", and a minute later lastError was "" with the same
// nine rows still stuck. It flapped on whether the latest tick happened to
// include a held row or a working one.
describe("held rows whose error string has been wiped", () => {
  it("still reports FAILING when the hold is old, even with no error anywhere", async () => {
    const { crmPushHealth: health } = await import("../leadsquared");
    h.heldSessions = 9;
    h.flushHealth = { flushed: 1, deferred: 0, lastError: "", lastOkAt: "2026-09-02T13:03:15Z" };
    h.oldestHeld = { last_error: null, created_at: "2026-08-26T09:00:00Z" };
    const r = await health();
    expect(r.state).toBe("failing");          // NOT "syncing — retrying automatically"
    expect(r.held).toBe(9);
    expect(r.detail).toContain("2026-08-26");
  });

  it("prefers the per-row reason over the per-tick one", async () => {
    const { crmPushHealth: health } = await import("../leadsquared");
    h.heldSessions = 4;
    h.flushHealth = { lastError: "", lastOkAt: null };
    h.oldestHeld = { last_error: "HTTP 500 (event 210): MXInvalidActivityException", created_at: "2026-08-26T09:00:00Z" };
    const r = await health();
    expect(r.state).toBe("failing");
    expect(r.detail).toContain("MXInvalidActivityException");
    expect(r.detail).toContain("210");        // names the activity code a person must fix
  });

  it("falls back to the per-tick error when the row has none (pre-0074)", async () => {
    const { crmPushHealth: health } = await import("../leadsquared");
    h.heldSessions = 2;
    h.flushHealth = { lastError: "Invalid event code", lastOkAt: null };
    h.oldestHeld = null;
    expect((await health()).detail).toContain("Invalid event code");
  });

  it("leaves a genuinely FRESH hold as a backlog, not a failure", async () => {
    // The backoff ramp is 5/15/60m. A hold inside that window really is
    // retrying on its own, and calling it a failure would cry wolf on every
    // transient LeadSquared blip.
    const { crmPushHealth: health } = await import("../leadsquared");
    h.heldSessions = 3;
    h.flushHealth = { lastError: "", lastOkAt: "2026-09-02T13:00:00Z" };
    h.oldestHeld = { last_error: null, created_at: new Date(Date.now() - 5 * 60_000).toISOString() };
    expect((await health()).state).toBe("syncing");
  });
});

