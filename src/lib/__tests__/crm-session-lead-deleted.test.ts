// A buffered session whose destination lead was DELETED in LeadSquared.
//
// Observed 5 Oct 2026: two rows for the office number (8880440011 as web chat,
// 918880440011 as WhatsApp) failing every tick with
//
//   HTTP 500 {"Status":"Error","ExceptionType":"MXInvalidEntityReferenceException",
//             "ExceptionMessage":"Lead not found","IsMXException":true}
//
// Leads.GetById returned [] for both ProspectIDs and RetrieveLeadByPhoneNumber
// returned 0 leads for all four candidate phone forms: the leads had been
// deleted outright, not merged. So the stale-id re-resolve (crm-stale-lead-id)
// could not help — it only retries when the lookup yields a DIFFERENT live id.
//
// With no live id and no terminal state, the row was held at the slowest
// backoff tier for ever, permanently reddening the CRM health bar. "Retry now"
// made it worse: retryHeldCrmSessions clears `attempts`, so each click restarted
// the ramp and the same error came straight back.
//
// A deleted lead is not a CRM outage. Nothing a person does to the LeadSquared
// config will make that push land, so the row gets a terminal state —
// DISCARDED — instead of being retried for ever.
//
// The discard is keyed NARROWLY, on two independent facts, because the 24 Aug
// outage (leadsquared-flush-never-drops) proved how expensive a wrong discard
// is:
//   1. LeadSquared rejected the LEAD REFERENCE specifically, and
//   2. a lookup that definitely SUCCEEDED found no lead for the phone.
// Anything less certain is still held.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  session: null as Record<string, unknown> | null,
  postedTo: [] as string[],
  postResults: [] as { status: number; body: string }[],
  /** null → lookup returns zero leads; "x" → resolves to x. */
  freshLeadId: null as string | null,
  /** true → every RetrieveLeadByPhoneNumber candidate is rejected (401/429). */
  lookupBroken: false,
  patches: [] as Record<string, unknown>[],
  deleted: [] as string[],
}));

vi.mock("../supabase", () => ({
  db: () => ({
    from: (table: string) => {
      if (table !== "wa_crm_session") {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }), upsert: () => Promise.resolve({ error: null }) };
      }
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        lte: () => chain,
        order: () => chain,
        limit: () => Promise.resolve({ data: h.session ? [h.session] : [], error: null }),
        update: (patch: Record<string, unknown>) => {
          h.patches.push(patch);
          const u: Record<string, unknown> = {
            eq: () => u,
            select: () => Promise.resolve({ data: [{ id: "s1" }], error: null }),
            then: (ok: (x: { error: null }) => void) => { ok({ error: null }); return Promise.resolve(); },
          };
          return u;
        },
        delete: () => ({ eq: () => ({ eq: () => { h.deleted.push("s1"); return Promise.resolve({ error: null }); } }) }),
      };
      return chain;
    },
  }),
}));

vi.mock("../errors", () => ({ errorMessage: (e: unknown) => String(e) }));

const LEAD_GONE = '{"Status":"Error","ExceptionType":"MXInvalidEntityReferenceException","ExceptionMessage":"Lead not found","IsMXException":true}';
const BAD_EVENT_CODE = '{"Status":"Failed","Message":{"Message":"Invalid event code"}}';

const ENV = { ...process.env };
beforeEach(() => {
  vi.resetModules();
  process.env = { ...ENV, LSQ_ACCESS_KEY: "a", LSQ_SECRET_KEY: "b", LSQ_API_HOST: "https://api-test.leadsquared.com", LSQ_ACTIVITY_CODE: "210" };
  h.session = { id: "s1", lead_id: "deleted-id", phone: "918880440011", lines: ["in: hi"], attempts: 1, last_message_at: "2026-10-05T10:00:00Z" };
  h.postedTo = []; h.postResults = []; h.freshLeadId = null; h.lookupBroken = false;
  h.patches = []; h.deleted = [];

  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    const u = String(url);
    if (u.includes("ProspectActivity.svc/Create")) {
      const body = JSON.parse(init?.body ?? "{}") as { RelatedProspectId?: string };
      h.postedTo.push(body.RelatedProspectId ?? "");
      const r = h.postResults.shift() ?? { status: 200, body: '{"Status":"Success"}' };
      return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => r.body, json: async () => JSON.parse(r.body) };
    }
    if (u.includes("RetrieveLeadByPhoneNumber")) {
      // A rejected lookup is NOT an answer — findLeadId throws when every
      // candidate form is refused, which is how a mis-escaped key / rate limit
      // is kept distinct from "this person isn't in the CRM".
      if (h.lookupBroken) return { ok: false, status: 401, text: async () => "unauthorized", json: async () => ({}) };
      const leads = h.freshLeadId ? [{ ProspectID: h.freshLeadId }] : [];
      return { ok: true, status: 200, text: async () => JSON.stringify(leads), json: async () => leads };
    }
    return { ok: true, status: 200, text: async () => "[]", json: async () => [] };
  }));
});

const statusWrites = () => h.patches.filter(p => "status" in p).map(p => p.status);
const holdWrites = () => h.patches.filter(p => "attempts" in p);

describe("the destination lead was deleted", () => {
  it("stops retrying for ever — the row reaches a terminal state", async () => {
    const { flushCrmSessions } = await import("../leadsquared");
    h.postResults = [{ status: 500, body: LEAD_GONE }];
    h.freshLeadId = null;                       // LSQ: no lead for this phone, definitively

    const r = await flushCrmSessions();

    expect(h.postedTo).toEqual(["deleted-id"]); // no pointless second POST
    expect(r.discarded).toBe(1);
    expect(r.deferred).toBe(0);                 // NOT parked for another attempt
    expect(statusWrites()).toEqual(["discarded"]);
  });

  it("keeps the messages — discarded is a status, never a delete", async () => {
    // The buffered lines are the only record that these messages still owe the
    // CRM. 24 Aug deleted them on failure and lost a day of real conversations.
    const { flushCrmSessions } = await import("../leadsquared");
    h.postResults = [{ status: 500, body: LEAD_GONE }];
    h.freshLeadId = null;

    await flushCrmSessions();

    expect(h.deleted).toEqual([]);
  });

  it("records why, so a discarded row can still be explained later", async () => {
    const { flushCrmSessions } = await import("../leadsquared");
    h.postResults = [{ status: 500, body: LEAD_GONE }];
    h.freshLeadId = null;

    await flushCrmSessions();

    const patch = h.patches.find(p => p.status === "discarded")!;
    expect(String(patch.last_error)).toMatch(/MXInvalidEntityReference|Lead not found/i);
  });
});

describe("what must NOT be discarded", () => {
  it("holds when the lookup itself failed — a 401 is not proof of absence", async () => {
    // getLeadIdByPhone swallows the throw and returns null, which reads exactly
    // like "no lead exists". Discarding on that would throw away real chat
    // history during a key rotation or a rate-limit spike.
    const { flushCrmSessions } = await import("../leadsquared");
    h.postResults = [{ status: 500, body: LEAD_GONE }];
    h.lookupBroken = true;

    const r = await flushCrmSessions();

    expect(r.discarded).toBe(0);
    expect(r.deferred).toBe(1);
    expect(statusWrites()).toEqual([]);
    expect(holdWrites()).toHaveLength(1);
  });

  it("holds a CRM-config rejection even when no lead matches the phone", async () => {
    // A deactivated activity type rejects EVERY push, including for leads that
    // genuinely exist. That is the 24 Aug outage, and it is fixable by a person
    // — so the row waits for them.
    const { flushCrmSessions } = await import("../leadsquared");
    h.postResults = [{ status: 500, body: BAD_EVENT_CODE }];
    h.freshLeadId = null;

    const r = await flushCrmSessions();

    expect(r.discarded).toBe(0);
    expect(r.deferred).toBe(1);
    expect(statusWrites()).toEqual([]);
  });

  it("still re-resolves and succeeds when the lead was merged, not deleted", async () => {
    // The crm-stale-lead-id path must survive unchanged: a merge leaves a
    // DIFFERENT live id behind, and that is a success, not a discard.
    const { flushCrmSessions } = await import("../leadsquared");
    h.postResults = [
      { status: 500, body: LEAD_GONE },
      { status: 200, body: '{"Status":"Success"}' },
    ];
    h.freshLeadId = "live-id";

    const r = await flushCrmSessions();

    expect(h.postedTo).toEqual(["deleted-id", "live-id"]);
    expect(r.flushed).toBe(1);
    expect(r.discarded).toBe(0);
    expect(h.deleted).toEqual(["s1"]);
  });

  it("holds a transient fault without spending a lookup", async () => {
    const { flushCrmSessions } = await import("../leadsquared");
    h.postResults = [{ status: 503, body: "upstream busy" }];
    h.freshLeadId = null;

    const r = await flushCrmSessions();

    expect(h.postedTo).toEqual(["deleted-id"]);
    expect(r.discarded).toBe(0);
    expect(r.deferred).toBe(1);
  });
});
