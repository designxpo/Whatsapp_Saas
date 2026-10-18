// Where the leads came from.
//
// The failure mode for an acquisition dashboard is not an error — it is a
// confident number over a sample too small to carry it. Measured 14 Oct, 36
// of 3,183 contacts carried any attribution; a table reading "Google (paid)
// 60%" over that would be a fact about the measurement wearing the clothes of
// a fact about the business.
//
// So these pin the arithmetic that keeps it honest: coverage is reported, the
// unattributed remainder is never dropped, and every rate below the fold is a
// share of the ATTRIBUTED population rather than quietly widening to all
// traffic halfway down the panel.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  convs: [] as Record<string, unknown>[],
  contacts: [] as Record<string, unknown>[],
  srcRows: [] as Record<string, unknown>[],
  throwOn: "" as string,
}));

vi.mock("../supabase", () => {
  // Every method stays chainable and the PROMISE is the `then` — leadsources
  // calls .gte() AFTER .range(), so a range() that resolved would break the
  // chain in the mock and nowhere else.
  const table = (name: string) => {
    let from = 0;
    const api: Record<string, unknown> = {
      // eq: the queries are tenant-scoped, so the chain takes a tenant filter first.
      select: () => api, eq: () => api, order: () => api, not: () => api, gte: () => api,
      range: (f: number) => { from = f; return api; },
      then: (res: (x: { data: unknown[] }) => unknown) => {
        if (h.throwOn === name) throw new Error("db down");
        const all = name === "wa_conversations" ? h.convs
          : name === "contacts" ? h.contacts
          : h.srcRows;
        // One page is enough for a test; page two is always empty.
        return res({ data: from === 0 ? all : [] });
      },
    };
    return api;
  };
  return { db: () => ({ from: (n: string) => table(n) }) };
});

const { getLeadSources } = await import("../leadsources");

const conv = (phone: string, o: { replied?: boolean; escalated?: boolean } = {}) => ({
  id: phone, phone, status: o.escalated ? "escalated" : "active",
  created_at: "2026-10-14T05:00:00Z",
  last_inbound_at: o.replied ? "2026-10-14T06:00:00Z" : "2026-10-14T05:00:00Z",
});
const contact = (phone: string, attributes: Record<string, string>) => ({ phone, attributes });

beforeEach(() => { h.convs = []; h.contacts = []; h.srcRows = []; h.throwOn = ""; });

describe("coverage — the number that qualifies every other number", () => {
  it("reports attributed against the whole population", async () => {
    h.convs = [conv("918000000001"), conv("918000000002"), conv("918000000003"), conv("918000000004")];
    h.contacts = [contact("918000000001", { utm_source: "google", utm_medium: "cpc" })];
    const d = await getLeadSources("30d");
    expect(d.coverage).toMatchObject({ chats: 4, attributed: 1, percent: 25 });
  });

  it("does not divide by zero on an empty window", async () => {
    const d = await getLeadSources("7d");
    expect(d.coverage.percent).toBe(0);
    expect(d.coverage.chats).toBe(0);
  });
});

describe("the unattributed remainder is never hidden", () => {
  it("is recoverable from the figures the panel renders", async () => {
    h.convs = Array.from({ length: 10 }, (_, i) => conv(`91800000000${i}`));
    h.contacts = [contact("918000000000", { handle_source: "ppc-wa-da-delhi" })];
    const d = await getLeadSources("30d");
    expect(d.coverage.chats - d.coverage.attributed).toBe(9);
  });

  it("never lets the breakdown exceed what was attributed", async () => {
    h.convs = [conv("918000000001"), conv("918000000002")];
    h.contacts = [contact("918000000001", { utm_source: "google", utm_medium: "cpc" })];
    const d = await getLeadSources("30d");
    const summed = d.bySource.reduce((n, r) => n + r.chats, 0);
    expect(summed).toBe(d.coverage.attributed);
  });
});

describe("grouping collapses the spellings, not the meaning", () => {
  it("counts fb, facebook and FB as one source", async () => {
    h.convs = [conv("918000000001"), conv("918000000002"), conv("918000000003")];
    h.contacts = [
      contact("918000000001", { utm_source: "fb", utm_medium: "paid_social" }),
      contact("918000000002", { utm_source: "facebook", utm_medium: "paid_social" }),
      contact("918000000003", { utm_source: "FB", utm_medium: "paid_social" }),
    ];
    const d = await getLeadSources("30d");
    const meta = d.bySource.filter(r => r.label.startsWith("Meta"));
    expect(meta).toHaveLength(1);
    expect(meta[0].chats).toBe(3);
  });

  it("keeps paid and organic apart — they are not the same channel", async () => {
    h.convs = [conv("918000000001"), conv("918000000002")];
    h.contacts = [
      contact("918000000001", { utm_source: "google", utm_medium: "cpc" }),
      contact("918000000002", { utm_source: "google", utm_medium: "organic" }),
    ];
    const d = await getLeadSources("30d");
    expect(d.bySource.map(r => r.label).sort()).toEqual(["Google (organic)", "Google (paid)"]);
  });

  it("falls back to the tracked link when there are no UTMs", async () => {
    h.convs = [conv("918000000001")];
    h.contacts = [contact("918000000001", { handle_source: "ppc-wa-ds-delhi" })];
    const d = await getLeadSources("30d");
    expect(d.bySource[0].label).toBe("ppc-wa-ds-delhi");
  });
});

describe("the funnel measures ONE population all the way down", () => {
  it("counts replies and hand-offs among attributed chats only", async () => {
    h.convs = [
      conv("918000000001", { replied: true }),              // attributed, replied
      conv("918000000002", { escalated: true }),            // attributed, handed over
      conv("918000000003", { replied: true }),              // NOT attributed
    ];
    h.contacts = [
      contact("918000000001", { utm_source: "google", utm_medium: "cpc" }),
      contact("918000000002", { utm_source: "google", utm_medium: "cpc" }),
    ];
    const d = await getLeadSources("30d");
    expect(d.funnel.chats).toBe(2);
    // The unattributed reply must NOT inflate the rate.
    expect(d.funnel.replied).toBe(1);
    expect(d.funnel.handedOver).toBe(1);
  });

  it("does not count the opening message as a reply", async () => {
    // created_at === last_inbound_at means they said one thing and stopped.
    h.convs = [conv("918000000001")];
    h.contacts = [contact("918000000001", { utm_source: "google", utm_medium: "cpc" })];
    const d = await getLeadSources("30d");
    expect(d.funnel.replied).toBe(0);
  });
});

describe("matching a contact to a conversation", () => {
  it("matches on the last ten digits, not the exact string", async () => {
    // LeadSquared stores ten digits, WhatsApp stores the country code. An
    // exact join finds nothing and reports every lead as unattributed.
    h.convs = [conv("918368872108")];
    h.contacts = [contact("8368872108", { utm_source: "google", utm_medium: "cpc" })];
    const d = await getLeadSources("30d");
    expect(d.coverage.attributed).toBe(1);
  });
});

describe("failure", () => {
  it("returns an empty panel rather than taking the dashboard down", async () => {
    h.throwOn = "wa_conversations";
    const d = await getLeadSources("30d");
    expect(d.coverage.chats).toBe(0);
    expect(d.bySource).toEqual([]);
  });
});
