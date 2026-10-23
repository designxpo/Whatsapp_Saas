// Asking LeadSquared which leads just reached a stage.
//
// This replaces an Automation that LeadSquared provides no API to create, so
// it is the only thing standing between a counsellor moving a lead and the
// drip starting. The failure that matters is not an error — it is a lead
// quietly not coming back, because then the drip simply never fires for that
// person and nothing anywhere says so.
//
// So these tests are mostly about the time window: what counts as "since",
// what happens to a lead with no readable ModifiedOn, and whether the
// newest-first early stop can cause a miss.
import { describe, it, expect, vi, beforeEach } from "vitest";

const sent: { url: string; body: Record<string, unknown> }[] = [];
let pages: Record<string, unknown>[][] = [];
let httpOk = true;

// This codebase calls the global fetch directly (wab wraps it in extFetch), so the
// fake stands in for fetch itself.
const fakeFetch = async (url: string, init?: { body?: string }) => {
  const body = init?.body ? JSON.parse(init.body) : {};
  sent.push({ url, body });
  const idx = (body?.Paging?.PageIndex ?? 1) - 1;
  const rows = pages[idx] ?? [];
  return { ok: httpOk, status: httpOk ? 200 : 500, json: async () => rows, text: async () => "" };
};

beforeEach(() => {
  sent.length = 0; pages = []; httpOk = true;
  vi.stubGlobal("fetch", fakeFetch);
  process.env.LSQ_ACCESS_KEY = "ak";
  process.env.LSQ_SECRET_KEY = "sk";
  process.env.LSQ_API_HOST = "https://api-test.leadsquared.com";
  process.env.LSQ_ACTIVITY_CODE = "100";
  vi.resetModules();
});

const load = async () => (await import("../leadsquared")).leadsOnStageSince;

/** LeadSquared's own format: no timezone marker, and it means UTC. */
const lsqRow = (over: Record<string, unknown> = {}) => ({
  ProspectID: "L1", FirstName: "Romi", LastName: "K",
  Phone: "9876543210", Mobile: "", EmailAddress: "romi@example.com",
  ProspectStage: "Not Reachable", Source: "PPC-whatsapp",
  OwnerIdName: "Jahnabi", OwnerIdEmailAddress: "Jahnabi@AnalytixLabs.co.in",
  mx_Lead_Score: "Hot", ModifiedOn: "2026-10-09 11:30:00.000",
  ...over,
});

const SINCE = Date.parse("2026-10-09T11:00:00.000Z");

describe("the query it sends", () => {
  it("anchors on the stage server-side and asks for ModifiedOn", async () => {
    pages = [[]];
    await (await load())("Not Reachable", SINCE);
    expect(sent[0].url).toContain("Leads.Get");
    expect(sent[0].body.Parameter).toEqual({ LookupName: "ProspectStage", LookupValue: "Not Reachable" });
    expect(String((sent[0].body.Columns as { Include_CSV: string }).Include_CSV)).toContain("ModifiedOn");
    expect(sent[0].body.Sorting).toEqual({ ColumnName: "ModifiedOn", Direction: "1" });
  });

  it("refuses a blank stage rather than asking for every lead in the account", async () => {
    const r = await (await load())("   ", SINCE);
    expect(r.error).toMatch(/stage/i);
    expect(sent).toHaveLength(0);
  });

  it("reports an HTTP failure instead of returning an empty list", async () => {
    // An empty list reads as "nobody moved", which is a lie that would make
    // the poll advance its watermark straight past a real batch.
    httpOk = false;
    pages = [[lsqRow()]];
    const r = await (await load())("Not Reachable", SINCE);
    expect(r.error).toContain("500");
    expect(r.changed).toHaveLength(0);
  });
});

describe("the time window", () => {
  it("keeps a lead modified after the watermark", async () => {
    pages = [[lsqRow({ ModifiedOn: "2026-10-09 11:30:00.000" })]];
    const r = await (await load())("Not Reachable", SINCE);
    expect(r.changed).toHaveLength(1);
    expect(r.changed[0].ev.phone).toBe("9876543210");
  });

  it("drops a lead modified before it", async () => {
    pages = [[lsqRow({ ModifiedOn: "2026-10-09 10:30:00.000" })]];
    expect((await (await load())("Not Reachable", SINCE)).changed).toHaveLength(0);
  });

  it("reads LeadSquared's zone-less timestamps as UTC, not as local time", async () => {
    // Production runs on UTC and the business on IST. Reading these with a
    // local clock would be five and a half hours out, which on a 5-minute
    // poll means either replaying everything or skipping everything.
    pages = [[lsqRow({ ModifiedOn: "2026-10-09 11:30:00.000" })]];
    const r = await (await load())("Not Reachable", SINCE);
    expect(r.changed[0].modifiedAt).toBe(Date.parse("2026-10-09T11:30:00.000Z"));
  });

  it("skips a lead with no readable ModifiedOn rather than treating it as new", async () => {
    // Calling it "now" would re-enrol the same lead on every single pass,
    // forever — the one failure mode that actually spams somebody.
    pages = [[lsqRow({ ModifiedOn: "" }), lsqRow({ ModifiedOn: "not a date", Phone: "9876500000" })]];
    expect((await (await load())("Not Reachable", SINCE)).changed).toHaveLength(0);
  });

  it("returns oldest first, so a caller's watermark only ever moves forward", async () => {
    pages = [[
      lsqRow({ Phone: "9000000003", ModifiedOn: "2026-10-09 11:50:00.000" }),
      lsqRow({ Phone: "9000000001", ModifiedOn: "2026-10-09 11:10:00.000" }),
      lsqRow({ Phone: "9000000002", ModifiedOn: "2026-10-09 11:30:00.000" }),
    ]];
    const r = await (await load())("Not Reachable", SINCE);
    expect(r.changed.map(c => c.ev.phone)).toEqual(["9000000001", "9000000002", "9000000003"]);
  });
});

describe("the lead it hands back", () => {
  it("maps every field the drip and the handover need", async () => {
    pages = [[lsqRow()]];
    const { ev } = (await (await load())("Not Reachable", SINCE)).changed[0];
    expect(ev).toMatchObject({
      event: "stage_changed",
      phone: "9876543210",
      name: "Romi K",
      email: "romi@example.com",
      ownerEmail: "jahnabi@analytixlabs.co.in",   // lower-cased: it is the join key to a portal member
      ownerName: "Jahnabi",
      stage: "Not Reachable",
      leadScore: "Hot",
      leadId: "L1",
      source: "PPC-whatsapp",
    });
  });

  it("labels itself stage_changed, which is what keeps lead-welcome from firing", async () => {
    pages = [[lsqRow()]];
    const { ev } = (await (await load())("Not Reachable", SINCE)).changed[0];
    expect(ev.event).toBe("stage_changed");
  });

  it("falls back to Mobile when Phone is empty", async () => {
    // In this account Phone is the mobile and Mobile is the ALTERNATE number,
    // so Phone wins — but a lead carrying only the alternate is still reachable.
    pages = [[lsqRow({ Phone: "", Mobile: "9812345678" })]];
    expect((await (await load())("Not Reachable", SINCE)).changed[0].ev.phone).toBe("9812345678");
  });

  it("drops a lead with no usable number", async () => {
    pages = [[lsqRow({ Phone: "12345", Mobile: "" })]];
    expect((await (await load())("Not Reachable", SINCE)).changed).toHaveLength(0);
  });

  it("returns one entry per person when two lead records share a number", async () => {
    pages = [[lsqRow({ ProspectID: "L1" }), lsqRow({ ProspectID: "L2", Phone: "919876543210" })]];
    expect((await (await load())("Not Reachable", SINCE)).changed).toHaveLength(1);
  });
});

describe("paging and limits", () => {
  it("stops at max and says it was truncated", async () => {
    pages = [Array.from({ length: 10 }, (_, i) => lsqRow({ Phone: `90000000${String(i).padStart(2, "0")}`, ModifiedOn: "2026-10-09 11:30:00.000" }))];
    const r = await (await load())("Not Reachable", SINCE, 4);
    expect(r.changed).toHaveLength(4);
    expect(r.truncated).toBe(true);
  });

  it("stops paging once a whole page is older than the watermark", async () => {
    pages = [
      Array.from({ length: 200 }, (_, i) => lsqRow({ Phone: `91000000${String(i).padStart(3, "0")}`, ModifiedOn: "2026-10-09 11:30:00.000" })),
      Array.from({ length: 200 }, (_, i) => lsqRow({ Phone: `92000000${String(i).padStart(3, "0")}`, ModifiedOn: "2026-10-09 09:00:00.000" })),
      [lsqRow({ Phone: "9300000000", ModifiedOn: "2026-10-09 11:59:00.000" })],
    ];
    const r = await (await load())("Not Reachable", SINCE, 1000);
    expect(r.changed).toHaveLength(200);
    // Page three is never requested: newest-first means everything after a
    // fully-stale page is staler still.
    expect(sent).toHaveLength(2);
  });
});
