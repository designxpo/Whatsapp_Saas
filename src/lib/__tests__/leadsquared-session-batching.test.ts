import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// A message used to post its own LeadSquared activity the instant it happened
// — a 6-question qualification flow left a lead's timeline as a dozen tiny
// entries. Messages are now buffered (wa_crm_session, 0098) and combined into
// ONE activity once the session goes quiet (flushCrmSessions). These tests
// exercise that buffering + flush against a tiny in-memory fake of the exact
// Supabase query-builder chains leadsquared.ts (and its resolveLsq fallback
// chain) actually calls — no real DB. Uses the DEFAULT tenant, whose creds
// fall back to the platform env vars once the (empty, faked) integrations/
// tenant-settings lookups come up empty.
type Row = Record<string, unknown>;

function makeFakeDb() {
  const tables: Record<string, Row[]> = {};
  let seq = 0;
  const table = (name: string) => (tables[name] ??= []);

  function applyFilters(list: Row[], filters: [string, unknown][]) {
    return list.filter(r => filters.every(([k, v]) => r[k] === v));
  }

  function from(name: string) {
    const rows = table(name);
    return {
      select(_cols?: string) {
        const filters: [string, unknown][] = [];
        let sortKey: string | null = null;
        let cap: number | null = null;
        const builder = {
          match(obj: Row) { filters.push(...(Object.entries(obj) as [string, unknown][])); return builder; },
          eq(k: string, v: unknown) { filters.push([k, v]); return builder; },
          in(_k: string, _v: unknown[]) { return builder; },
          lte(k: string, v: string) {
            const list = applyFilters(rows, filters).filter(r => (r[k] as string) <= v);
            filters.length = 0;
            (builder as unknown as { _pre: Row[] })._pre = list;
            return builder;
          },
          order(k: string) { sortKey = k; return builder; },
          limit(n: number) { cap = n; return builder; },
          async maybeSingle() {
            const list = applyFilters(rows, filters);
            return { data: list[0] ? { ...list[0] } : null, error: null };
          },
          async single() {
            const list = applyFilters(rows, filters);
            return list[0] ? { data: { ...list[0] }, error: null } : { data: null, error: { message: "no rows" } };
          },
          then(resolve: (v: { data: Row[]; error: null; count: number }) => void) {
            const pre = (builder as unknown as { _pre?: Row[] })._pre;
            let list = pre ?? applyFilters(rows, filters);
            const key = sortKey;
            if (key) list = [...list].sort((a, b) => String(a[key]).localeCompare(String(b[key])));
            if (cap != null) list = list.slice(0, cap);
            resolve({ data: list.map(r => ({ ...r })), error: null, count: list.length });
          },
        };
        return builder;
      },
      insert(obj: Row) {
        const dup = name === "wa_crm_session" && rows.some(r => r.kind === obj.kind && r.phone === obj.phone && r.channel === obj.channel && r.tenant_id === obj.tenant_id);
        if (dup) return Promise.resolve({ data: null, error: { message: "duplicate key value violates unique constraint" } });
        rows.push({ id: `row_${seq++}`, attempts: 0, last_message_at: new Date().toISOString(), ...obj });
        return Promise.resolve({ data: [obj], error: null });
      },
      update(patch: Row) {
        const filters: [string, unknown][] = [];
        const builder = {
          eq(k: string, v: unknown) { filters.push([k, v]); return builder; },
          select(_cols?: string) {
            const list = applyFilters(rows, filters);
            for (const r of list) Object.assign(r, patch);
            return Promise.resolve({ data: list.map(r => ({ id: r.id })), error: null });
          },
          then(resolve: (v: { data: Row[]; error: null }) => void) {
            const list = applyFilters(rows, filters);
            for (const r of list) Object.assign(r, patch);
            resolve({ data: list.map(r => ({ ...r })), error: null });
          },
        };
        return builder;
      },
      delete() {
        const filters: [string, unknown][] = [];
        const builder = {
          eq(k: string, v: unknown) { filters.push([k, v]); return builder; },
          then(resolve: (v: { error: null }) => void) {
            const list = applyFilters(rows, filters);
            for (const r of list) { const i = rows.indexOf(r); if (i >= 0) rows.splice(i, 1); }
            resolve({ error: null });
          },
        };
        return builder;
      },
    };
  }
  return { from, __tables: tables, __rows: (n: string) => table(n) };
}

const fakeDb = makeFakeDb();
vi.mock("../supabase", () => ({ db: () => fakeDb }));

// Import AFTER the mock so leadsquared.ts's `db()` resolves to our fake.
const { pushWaActivity, pushChatActivity, flushCrmSessions } = await import("../leadsquared");

describe("CRM session batching (wa_crm_session, multi-tenant)", () => {
  const calls: { url: string; body?: string }[] = [];
  function stubExistingLead(prospectId: string) {
    calls.length = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: unknown, opts?: { body?: string }) => {
      calls.push({ url: String(url), body: opts?.body });
      if (String(url).includes("RetrieveLeadByPhoneNumber")) return { ok: true, json: async () => [{ ProspectID: prospectId }] } as unknown as Response;
      return { ok: true, json: async () => ({ Status: "Success" }), text: async () => "" } as unknown as Response;
    }));
  }
  const activityCalls = () => calls.filter(c => c.url.includes("ProspectActivity.svc/Create"));

  beforeEach(() => {
    for (const k of Object.keys(fakeDb.__tables)) fakeDb.__tables[k].length = 0;
    process.env.LSQ_ACCESS_KEY = "ak";
    process.env.LSQ_SECRET_KEY = "sk";
    process.env.LSQ_API_HOST = "https://api-test.leadsquared.com";
    process.env.LSQ_ACTIVITY_CODE = "210";
    process.env.LSQ_AUTOCREATE_LEADS = "true";
    delete process.env.LSQ_SESSION_GAP_MINUTES;
  });
  afterEach(() => vi.unstubAllGlobals());

  it("buffers messages instead of posting an activity immediately", async () => {
    stubExistingLead("L1");
    await pushWaActivity({ phone: "+919000000001", direction: "inbound", body: "Hi", via: "lead" });
    expect(activityCalls().length).toBe(0);
    const rows = fakeDb.__rows("wa_crm_session");
    expect(rows.length).toBe(1);
    expect(rows[0].lines).toEqual(["⬅️ Lead: Hi"]);
  });

  it("combines several messages for the same lead into ONE buffered row", async () => {
    stubExistingLead("L2");
    await pushWaActivity({ phone: "+919000000002", direction: "inbound", body: "Hi", via: "lead" });
    await pushWaActivity({ phone: "+919000000002", direction: "outbound", body: "How many years of experience?", via: "bot" });
    await pushWaActivity({ phone: "+919000000002", direction: "inbound", body: "3 years", via: "lead" });
    const rows = fakeDb.__rows("wa_crm_session");
    expect(rows.length).toBe(1);
    expect(rows[0].lines).toEqual([
      "⬅️ Lead: Hi",
      "➡️ AI Assistant: How many years of experience?",
      "⬅️ Lead: 3 years",
    ]);
  });

  it("keeps a Messenger session and a WhatsApp session for the same phone separate", async () => {
    stubExistingLead("L3");
    await pushWaActivity({ phone: "+919000000005", direction: "inbound", body: "wa hi", via: "lead" });
    await pushChatActivity({ phone: "+919000000005", direction: "inbound", body: "fb hi", via: "lead", channel: "Messenger" });
    expect(fakeDb.__rows("wa_crm_session").length).toBe(2);
  });

  it("does NOT flush a session that hasn't gone quiet yet", async () => {
    stubExistingLead("L5");
    await pushWaActivity({ phone: "+919000000006", direction: "inbound", body: "Hi", via: "lead" });
    const r = await flushCrmSessions();
    expect(r.flushed).toBe(0);
    expect(fakeDb.__rows("wa_crm_session").length).toBe(1);
  });

  it("flushes a quiet session as ONE combined activity, then removes the buffer row", async () => {
    process.env.LSQ_SESSION_GAP_MINUTES = "10";
    stubExistingLead("L6");
    await pushWaActivity({ phone: "+919000000007", direction: "inbound", body: "Hi", via: "lead" });
    await pushWaActivity({ phone: "+919000000007", direction: "outbound", body: "What's your city?", via: "bot" });
    const rows = fakeDb.__rows("wa_crm_session");
    rows[0].last_message_at = new Date(Date.now() - 11 * 60_000).toISOString();

    const r = await flushCrmSessions();
    expect(r.flushed).toBe(1);
    expect(fakeDb.__rows("wa_crm_session").length).toBe(0);

    const posted = activityCalls();
    expect(posted.length).toBe(1);
    const body = JSON.parse(posted[0].body!);
    expect(body.RelatedProspectId).toBe("L6");
    expect(body.ActivityNote).toBe("⬅️ Lead: Hi\n➡️ AI Assistant: What's your city?");
  });

  it("leaves the row leased (retried later) on a retriable LeadSquared failure", async () => {
    process.env.LSQ_SESSION_GAP_MINUTES = "10";
    calls.length = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: unknown, opts?: { body?: string }) => {
      calls.push({ url: String(url), body: opts?.body });
      if (String(url).includes("RetrieveLeadByPhoneNumber")) return { ok: true, json: async () => [{ ProspectID: "L7" }] } as unknown as Response;
      if (String(url).includes("ProspectActivity.svc/Create")) return { ok: false, status: 503, text: async () => "Service unavailable" } as unknown as Response;
      return { ok: true, json: async () => ({ Status: "Success" }), text: async () => "" } as unknown as Response;
    }));
    await pushWaActivity({ phone: "+919000000008", direction: "inbound", body: "Hi", via: "lead" });
    const rows = fakeDb.__rows("wa_crm_session");
    rows[0].last_message_at = new Date(Date.now() - 11 * 60_000).toISOString();

    const r = await flushCrmSessions();
    expect(r.flushed).toBe(0);
    expect(r.deferred).toBe(1);
    expect(fakeDb.__rows("wa_crm_session").length).toBe(1);
    expect(fakeDb.__rows("wa_crm_session")[0].attempts).toBe(1);
  });
});
