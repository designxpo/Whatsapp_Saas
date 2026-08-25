import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Regression cover for a real, day-long silent outage seen on the internal
// build (24 Aug 2026), whose defects existed here identically.
//
// A tenant's "Whatsapp chat logs" custom activity was deactivated inside
// LeadSquared, so every ProspectActivity.svc/Create was rejected. Two code
// defects turned that CRM config change into DATA LOSS:
//
//   1. LeadSquared reports invalid input as HTTP 500 (MXException) and even as
//      HTTP 200 with {"Status":"Failed"} — the 200 case was read as SUCCESS and
//      the buffered messages were deleted immediately.
//   2. On failure the buffer row was deleted once it hit an attempt cap, so
//      real customer messages that existed nowhere else in the CRM were thrown
//      away — while verifyLsq (a READ probe) still reported "Connected".
//
// A buffered session is the only record that these messages still owe the CRM,
// so the contract is: NEVER delete a buffered row on failure. Hold it, and let
// it flush itself once that tenant's CRM side is fixed.
type Row = Record<string, unknown>;
const deletedSessionRows: Row[] = [];

function makeFakeDb() {
  const tables: Record<string, Row[]> = {};
  let seq = 0;
  const table = (n: string) => (tables[n] ??= []);
  const applyFilters = (l: Row[], f: [string, unknown][]) => l.filter(r => f.every(([k, v]) => r[k] === v));

  function from(name: string) {
    const rows = table(name);
    return {
      select(_cols?: string, _opts?: unknown) {
        const filters: [string, unknown][] = [];
        let sortKey: string | null = null, cap: number | null = null;
        const b = {
          match(o: Row) { filters.push(...(Object.entries(o) as [string, unknown][])); return b; },
          eq(k: string, v: unknown) { filters.push([k, v]); return b; },
          in(_k: string, _v: unknown[]) { return b; },
          gt(k: string, v: number) {
            const l = applyFilters(rows, filters).filter(r => Number(r[k]) > v);
            filters.length = 0; (b as unknown as { _pre: Row[] })._pre = l; return b;
          },
          lte(k: string, v: string) {
            const l = applyFilters(rows, filters).filter(r => (r[k] as string) <= v);
            filters.length = 0; (b as unknown as { _pre: Row[] })._pre = l; return b;
          },
          order(k: string) { sortKey = k; return b; },
          limit(n: number) { cap = n; return b; },
          async maybeSingle() { const l = applyFilters(rows, filters); return { data: l[0] ? { ...l[0] } : null, error: null }; },
          async single() { const l = applyFilters(rows, filters); return l[0] ? { data: { ...l[0] }, error: null } : { data: null, error: { message: "no rows" } }; },
          then(res: (v: { data: Row[]; error: null; count: number }) => void) {
            const pre = (b as unknown as { _pre?: Row[] })._pre;
            let l = pre ?? applyFilters(rows, filters);
            if (sortKey) l = [...l].sort((x, y) => String(x[sortKey!]).localeCompare(String(y[sortKey!])));
            if (cap != null) l = l.slice(0, cap);
            res({ data: l.map(r => ({ ...r })), error: null, count: l.length });
          },
        };
        return b;
      },
      insert(o: Row) {
        if (name === "wa_crm_session" && rows.some(r => r.kind === o.kind && r.phone === o.phone && r.channel === o.channel && r.tenant_id === o.tenant_id))
          return Promise.resolve({ data: null, error: { message: "duplicate key" } });
        rows.push({ id: `row_${seq++}`, attempts: 0, last_message_at: new Date().toISOString(), ...o });
        return Promise.resolve({ data: [o], error: null });
      },
      upsert(_o: Row, _opts?: unknown) { return Promise.resolve({ data: null, error: null }); },
      update(patch: Row) {
        const filters: [string, unknown][] = [];
        const b = {
          eq(k: string, v: unknown) { filters.push([k, v]); return b; },
          select(_c?: string) {
            const l = applyFilters(rows, filters);
            for (const r of l) Object.assign(r, patch);
            return Promise.resolve({ data: l.map(r => ({ id: r.id })), error: null });
          },
          then(res: (v: { data: Row[]; error: null }) => void) {
            const l = applyFilters(rows, filters);
            for (const r of l) Object.assign(r, patch);
            res({ data: l.map(r => ({ ...r })), error: null });
          },
        };
        return b;
      },
      delete() {
        const filters: [string, unknown][] = [];
        const b = {
          eq(k: string, v: unknown) { filters.push([k, v]); return b; },
          then(res: (v: { error: null }) => void) {
            const l = applyFilters(rows, filters);
            if (name === "wa_crm_session") deletedSessionRows.push(...l.map(r => ({ ...r })));
            for (const r of l) { const i = rows.indexOf(r); if (i >= 0) rows.splice(i, 1); }
            res({ error: null });
          },
        };
        return b;
      },
    };
  }
  return { from, __tables: tables, __rows: (n: string) => table(n) };
}

const fakeDb = makeFakeDb();
vi.mock("../supabase", () => ({ db: () => fakeDb }));

const { pushWaActivity, flushCrmSessions } = await import("../leadsquared");

/** Lead lookup always succeeds; the activity Create answers however the test says. */
function stubCreate(resp: { ok: boolean; status?: number; text: string }) {
  vi.stubGlobal("fetch", vi.fn(async (url: unknown) => {
    if (String(url).includes("RetrieveLeadByPhoneNumber"))
      return { ok: true, json: async () => [{ ProspectID: "LEAD1" }] } as unknown as Response;
    return { ok: resp.ok, status: resp.status ?? (resp.ok ? 200 : 500), text: async () => resp.text } as unknown as Response;
  }));
}
const sessions = () => fakeDb.__rows("wa_crm_session");

async function bufferOneDueSession(phone: string) {
  await pushWaActivity({ phone, direction: "outbound", body: "Fees are 80,240", via: "agent" });
  sessions()[0].last_message_at = new Date(Date.now() - 11 * 60_000).toISOString();
}

describe("flushCrmSessions never discards buffered customer messages", () => {
  beforeEach(() => {
    for (const k of Object.keys(fakeDb.__tables)) fakeDb.__tables[k].length = 0;
    deletedSessionRows.length = 0;
    process.env.LSQ_ACCESS_KEY = "ak";
    process.env.LSQ_SECRET_KEY = "sk";
    process.env.LSQ_API_HOST = "https://api-test.leadsquared.com";
    process.env.LSQ_ACTIVITY_CODE = "210";
    process.env.LSQ_SESSION_GAP_MINUTES = "10";
    process.env.LSQ_AUTOCREATE_LEADS = "true";
  });
  afterEach(() => vi.unstubAllGlobals());

  it("does NOT count LeadSquared's HTTP 200 + {\"Status\":\"Failed\"} as a successful push", async () => {
    stubCreate({ ok: true, status: 200, text: '{"Status":"Failed","Message":{"Message":"Invalid event code"}}' });
    await bufferOneDueSession("+919000000101");

    const r = await flushCrmSessions();
    expect(r.flushed).toBe(0);
    expect(sessions().length).toBe(1);
    expect(deletedSessionRows).toHaveLength(0);
  });

  it("treats an MXException 500 as permanent and holds the row at the slowest backoff", async () => {
    stubCreate({ ok: false, status: 500, text: '{"Status":"Error","ExceptionType":"MXInvalidActivityException","ExceptionMessage":"Event Code is invalid or empty","IsMXException":true}' });
    await bufferOneDueSession("+919000000102");

    const r = await flushCrmSessions();
    expect(r.deferred).toBe(1);
    expect(sessions().length).toBe(1);
    // Slowest tier (24h) on the FIRST attempt — a CRM config error cannot
    // self-heal in five minutes, so we must not hammer LSQ until a human fixes it.
    const waitMs = new Date(sessions()[0].last_message_at as string).getTime() - Date.now();
    expect(waitMs).toBeGreaterThan(23 * 60 * 60_000);
  });

  it("still ramps gently for a genuine transient outage", async () => {
    stubCreate({ ok: false, status: 503, text: "Service Unavailable" });
    await bufferOneDueSession("+919000000103");

    await flushCrmSessions();
    expect(sessions()[0].attempts).toBe(1);
    const waitMs = new Date(sessions()[0].last_message_at as string).getTime() - Date.now();
    expect(waitMs).toBeLessThan(10 * 60_000);
    expect(waitMs).toBeGreaterThan(0);
  });

  it("keeps the messages through many consecutive failures instead of dropping them at a cap", async () => {
    stubCreate({ ok: false, status: 500, text: '{"IsMXException":true,"ExceptionMessage":"Invalid event code"}' });
    await bufferOneDueSession("+919000000104");

    for (let i = 0; i < 8; i++) {
      sessions()[0].last_message_at = new Date(Date.now() - 11 * 60_000).toISOString();
      await flushCrmSessions();
    }
    expect(sessions().length).toBe(1);          // survived well past the old cap of 5
    expect(deletedSessionRows).toHaveLength(0);
    expect(sessions()[0].lines).toEqual(["➡️ Agent: Fees are 80,240"]);
  });

  it("flushes and clears the row as soon as LeadSquared accepts it again", async () => {
    stubCreate({ ok: false, status: 500, text: '{"IsMXException":true,"ExceptionMessage":"Invalid event code"}' });
    await bufferOneDueSession("+919000000105");
    await flushCrmSessions();
    expect(sessions().length).toBe(1);

    // Tenant reactivates the custom activity in LeadSquared — no redeploy and
    // no backfill: the held row posts itself on the next due flush.
    stubCreate({ ok: true, status: 200, text: '{"Status":"Success"}' });
    sessions()[0].last_message_at = new Date(Date.now() - 11 * 60_000).toISOString();
    const r = await flushCrmSessions();
    expect(r.flushed).toBe(1);
    expect(sessions().length).toBe(0);
  });
});
