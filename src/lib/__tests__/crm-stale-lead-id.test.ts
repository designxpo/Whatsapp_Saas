// A permanently rejected CRM push re-resolves the lead id.
//
// lead_id is captured when the FIRST message of a session arrives and reused at
// flush time, which can be hours later. LeadSquared merges duplicate leads —
// their Meta lead-form integration creates a second lead for the same phone, so
// the same person exists twice — and a merge keeps one ProspectID and discards
// the other. If ours was the discarded one, every push for that session fails
// forever.
//
// It fails with the SAME shape as a bad event code (HTTP 500 + Status:Failed,
// non-retriable), which is exactly why the 2 Sep outage first looked like a
// deactivated activity type. What actually settled it: all nine held sessions
// stored a ProspectID that no longer matched what LeadSquared returned for the
// same phone, while a live lead existed for every one of them.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  session: null as Record<string, unknown> | null,
  postedTo: [] as string[],
  postResults: [] as { status: number; body: string }[],
  freshLeadId: null as string | null,
  leadIdWrites: [] as string[],
  deleted: [] as string[],
  holds: [] as Record<string, unknown>[],
}));

vi.mock("../supabase", () => ({
  db: () => ({
    from: (table: string) => {
      if (table !== "wa_crm_session") {
        // wa_settings (flush health) — accept and ignore.
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }), upsert: () => Promise.resolve({ error: null }) };
      }
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        lte: () => chain,
        order: () => chain,
        limit: () => Promise.resolve({ data: h.session ? [h.session] : [], error: null }),
        update: (patch: Record<string, unknown>) => {
          if ("lead_id" in patch) h.leadIdWrites.push(patch.lead_id as string);
          else h.holds.push(patch);
          const u: Record<string, unknown> = {
            eq: () => u,
            select: () => Promise.resolve({ data: [{ id: "s1" }], error: null }),
            then: (ok: (x: { error: null }) => void) => { ok({ error: null }); return Promise.resolve(); },
          };
          return u;
        },
        delete: () => ({ eq: () => ({ eq: (_c: string, _v: string) => { h.deleted.push("s1"); return Promise.resolve({ error: null }); } }) }),
      };
      return chain;
    },
  }),
}));

vi.mock("../errors", () => ({ errorMessage: (e: unknown) => String(e) }));

const ENV = { ...process.env };
beforeEach(() => {
  vi.resetModules();
  process.env = { ...ENV, LSQ_ACCESS_KEY: "a", LSQ_SECRET_KEY: "b", LSQ_API_HOST: "https://lsq.example.com", LSQ_ACTIVITY_CODE: "210" };
  h.session = { id: "s1", lead_id: "dead-id", phone: "919821253104", lines: ["in: hi"], attempts: 0, last_message_at: "2026-09-02T10:00:00Z" };
  h.postedTo = []; h.postResults = []; h.freshLeadId = null;
  h.leadIdWrites = []; h.deleted = []; h.holds = [];

  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    const u = String(url);
    if (u.includes("ProspectActivity.svc/Create")) {
      const body = JSON.parse(init?.body ?? "{}") as { RelatedProspectId?: string };
      h.postedTo.push(body.RelatedProspectId ?? "");
      const r = h.postResults.shift() ?? { status: 200, body: '{"Status":"Success"}' };
      return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => r.body, json: async () => JSON.parse(r.body) };
    }
    if (u.includes("RetrieveLeadByPhoneNumber")) {
      const leads = h.freshLeadId ? [{ ProspectID: h.freshLeadId }] : [];
      return { ok: true, status: 200, text: async () => JSON.stringify(leads), json: async () => leads };
    }
    return { ok: true, status: 200, text: async () => "[]", json: async () => [] };
  }));
});

describe("stale lead id", () => {
  it("retries with the id LeadSquared resolves now, and persists it", async () => {
    const { flushCrmSessions } = await import("../leadsquared");
    h.postResults = [
      { status: 500, body: '{"Status":"Failed","Message":{"Message":"Invalid lead"}}' },   // the dead id
      { status: 200, body: '{"Status":"Success"}' },                                        // the live one
    ];
    h.freshLeadId = "live-id";
    const r = await flushCrmSessions();
    expect(h.postedTo).toEqual(["dead-id", "live-id"]);
    expect(r.flushed).toBe(1);
    expect(h.leadIdWrites).toContain("live-id");   // next line of this chat uses the live id
    expect(h.deleted).toEqual(["s1"]);             // session cleared, not held
  });

  it("does NOT re-resolve on a retriable fault — a blip shouldn't cost a lookup", async () => {
    const { flushCrmSessions } = await import("../leadsquared");
    h.session = { ...h.session!, lead_id: "good-id" };
    h.postResults = [{ status: 503, body: "upstream busy" }];
    h.freshLeadId = "other-id";
    const r = await flushCrmSessions();
    expect(h.postedTo).toEqual(["good-id"]);       // one attempt only
    expect(r.deferred).toBe(1);
  });

  it("does not mask a genuine rejection when the id is already current", async () => {
    // If LeadSquared is refusing for a real reason — a deactivated event code —
    // re-resolving returns the same id and the row must still be held, not
    // silently retried into a false success.
    const { flushCrmSessions } = await import("../leadsquared");
    h.session = { ...h.session!, lead_id: "same-id" };
    h.postResults = [{ status: 500, body: '{"Status":"Failed","Message":{"Message":"Invalid event code"}}' }];
    h.freshLeadId = "same-id";
    const r = await flushCrmSessions();
    expect(h.postedTo).toEqual(["same-id"]);       // no pointless second POST
    expect(r.flushed).toBe(0);
    expect(r.deferred).toBe(1);
  });

  it("holds the row when the retry also fails, so nothing is lost", async () => {
    const { flushCrmSessions } = await import("../leadsquared");
    h.postResults = [
      { status: 500, body: '{"Status":"Failed"}' },
      { status: 500, body: '{"Status":"Failed"}' },
    ];
    h.freshLeadId = "live-id";
    const r = await flushCrmSessions();
    expect(r.flushed).toBe(0);
    expect(h.deleted).toEqual([]);                 // NEVER deleted on failure
    expect(h.holds.filter(p => "attempts" in p)).toHaveLength(1);
  });

  it("survives LeadSquared knowing no lead for that phone at all", async () => {
    const { flushCrmSessions } = await import("../leadsquared");
    h.postResults = [{ status: 500, body: '{"Status":"Failed"}' }];
    h.freshLeadId = null;                          // lookup returns []
    const r = await flushCrmSessions();
    expect(h.postedTo).toEqual(["dead-id"]);
    expect(r.deferred).toBe(1);
  });
});
