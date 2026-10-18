// Per-chat LeadSquared status — the guard for the join, not the rendering.
//
// The whole feature is a lookup between two tables that store phone numbers in
// DIFFERENT shapes: wa_crm_session.phone holds whatever digits arrived on the
// message ("8368872108"), while a conversation holds the full international
// number ("918368872108"). An exact-string join finds nothing and paints every
// chat green — a status indicator that is confidently wrong is worse than no
// indicator, because it is the thing people will trust instead of looking.
//
// That exact mismatch has already produced one silent bug in this codebase
// (consentMissing keyed on last-10 but queried on full digits), so it gets a
// test rather than a comment.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { crmChatKey } from "../crmkey";

const h = vi.hoisted(() => ({
  sessions: [] as Record<string, unknown>[],
  sync: [] as Record<string, unknown>[],
  settings: [] as Record<string, unknown>[],
}));

// Fake of the two chains crmChatStatuses drives:
//   .select(cols).order(col).range(a,b)          → paged read
//   .select(cols).eq(k,v).order(col).range(a,b)  → paged read, filtered
// plus the .select().eq().maybeSingle() that crmSessionStats uses for settings,
// and its head/count call.
vi.mock("../supabase", () => {
  const rowsFor = (t: string) =>
    t === "wa_crm_session" ? h.sessions : t === "wa_crm_sync" ? h.sync : h.settings;
  return {
    db: () => ({
      from(table: string) {
        return {
          select(_cols?: string, opts?: { count?: string; head?: boolean }) {
            const filters: [string, unknown][] = [];
            const ins: [string, unknown[]][] = [];
            const gts: [string, number][] = [];
            // A filter on a column the fixture row does not carry (tenant_id,
            // status) is a no-op: fixtures describe the default tenant's pending rows.
            const rows = () => rowsFor(table)
              .filter(r => filters.every(([k, v]) => !(k in r) || r[k] === v))
              .filter(r => ins.every(([k, vs]) => !(k in r) || vs.includes(r[k])))
              .filter(r => gts.every(([k, v]) => Number(r[k] ?? 0) > v));
            const b = {
              eq(k: string, v: unknown) { filters.push([k, v]); return b; },
              in(k: string, vs: unknown[]) { ins.push([k, vs]); return b; },
              gt(k: string, v: number) { gts.push([k, v]); return b; },
              order() { return b; },
              async range(from: number, to: number) {
                return { data: rows().slice(from, to + 1).map(r => ({ ...r })), error: null };
              },
              async maybeSingle() { const hit = rows()[0]; return { data: hit ? { ...hit } : null, error: null }; },
              // head+count form used by crmSessionStats
              then(res: (v: { count: number; data: null; error: null }) => unknown) {
                return Promise.resolve(res({ count: opts?.head ? rows().length : rows().length, data: null, error: null }));
              },
            };
            return b;
          },
        };
      },
    }),
  };
});

// lsqConfigured() reads these; without them crmChatStatuses short-circuits to
// "not configured" and the join under test never runs.
beforeEach(() => {
  h.sessions.length = 0; h.sync.length = 0; h.settings.length = 0;
  vi.stubEnv("LSQ_ACCESS_KEY", "k");
  vi.stubEnv("LSQ_SECRET_KEY", "s");
  vi.stubEnv("LSQ_API_HOST", "https://api.example.com");
  vi.stubEnv("LSQ_ACTIVITY_CODE", "200");
});

async function statuses() {
  const { crmChatStatuses } = await import("../leadsquared");
  return crmChatStatuses();
}

describe("crmChatKey", () => {
  it("matches the same person across country-code shapes", () => {
    // The bug this whole module exists to avoid.
    expect(crmChatKey("8368872108")).toBe(crmChatKey("918368872108"));
    expect(crmChatKey("+91 83688 72108")).toBe(crmChatKey("918368872108"));
    expect(crmChatKey("12813872780")).toBe("2813872780");
  });

  it("keeps phone-less identities as themselves rather than collapsing them", () => {
    // "handle:@x" has no 10 digits to slice, so it must survive intact — two
    // different Instagram handles must not both key to "".
    expect(crmChatKey("handle:@alice")).toBe("handle:@alice");
    expect(crmChatKey("handle:@alice")).not.toBe(crmChatKey("handle:@bob"));
    expect(crmChatKey("")).toBe("");
    expect(crmChatKey(null)).toBe("");
  });
});

describe("crmChatStatuses", () => {
  it("reports a fresh buffer as queued, not as a failure", async () => {
    // A live conversation is SUPPOSED to sit in the buffer: messages are batched
    // into one timeline note once the chat goes quiet. Painting that red would
    // train people to ignore the indicator.
    h.sessions.push({ phone: "919876543210", attempts: 0, last_message_at: new Date().toISOString() });
    const r = await statuses();
    expect(r.configured).toBe(true);
    expect(r.statuses["9876543210"].state).toBe("queued");
    expect(r.statuses["9876543210"].dueAt).toBeTruthy();
  });

  it("reports a failed buffer as held, carrying the attempt count", async () => {
    h.sessions.push({ phone: "8368872108", attempts: 4, last_message_at: new Date().toISOString() });
    const r = await statuses();
    expect(r.statuses["8368872108"]).toMatchObject({ state: "held", attempts: 4 });
  });

  it("has no entry for a chat with nothing pending", async () => {
    // Absence is the "clear" signal — the UI turns a missing key into green, so
    // this must stay absent rather than becoming an explicit row.
    h.sessions.push({ phone: "919876543210", attempts: 0, last_message_at: new Date().toISOString() });
    const r = await statuses();
    expect(r.statuses["8368872108"]).toBeUndefined();
  });

  it("lets an abandoned push outrank a buffered one for the same person", async () => {
    // Dead means data is missing for good; queued means it is on its way. If a
    // person has both, the one that needs a human wins.
    h.sessions.push({ phone: "918368872108", attempts: 0, last_message_at: new Date().toISOString() });
    h.sync.push({ status: "dead", payload: { phone: "8368872108" } });
    const r = await statuses();
    expect(r.statuses["8368872108"].state).toBe("dead");
  });

  it("keys an abandoned push for a phone-less lead by its handle", async () => {
    h.sync.push({ status: "dead", payload: { handle: "@someone" } });
    const r = await statuses();
    expect(r.statuses["handle:@someone"].state).toBe("dead");
  });

  it("says nothing at all when LeadSquared isn't configured", async () => {
    vi.stubEnv("LSQ_ACCESS_KEY", "");
    h.sessions.push({ phone: "918368872108", attempts: 9, last_message_at: new Date().toISOString() });
    const r = await statuses();
    expect(r).toEqual({ configured: false, statuses: {}, lastError: "" });
  });
});
