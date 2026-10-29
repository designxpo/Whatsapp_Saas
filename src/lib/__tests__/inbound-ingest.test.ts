// One event from a connected tool, acted on exactly once — for its business.
//
// Every tool retries. A retried order must not send its confirmation twice; a
// delivery that FAILED must be allowed to run again; an event without a phone
// must not block the later one that has it; an order must cancel the
// abandoned-cart reminder still waiting for that shopper. And every step names
// the connection's tenant: db() is the service client, so the filter is what
// keeps one business's customers out of another's.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  claimed: new Set<string>(),
  settled: [] as [string, string, string][],
  upserts: [] as { rows: unknown[]; tenantId: string }[],
  events: [] as { params: unknown; tenantId: string }[],
  cancelled: [] as { ids: string[]; phone: string; tenants: string[] }[],
  rules: [{ rule: "Order confirmation", outcome: "scheduled" }] as { rule: string; outcome: string; detail?: string }[],
  activity: [] as unknown[],
}));

vi.mock("../inbound/store", () => ({
  claimEvent: async (_i: unknown, e: { externalId: string | null }) => {
    if (e.externalId && h.claimed.has(e.externalId)) return null;
    if (e.externalId) h.claimed.add(e.externalId);
    return `ev-${h.settled.length + h.claimed.size}`;
  },
  settleEvent: async (tenantId: string, id: string, outcome: string) => { h.settled.push([tenantId, id, outcome]); },
  noteActivity: async (_i: unknown, p: unknown) => { h.activity.push(p); },
}));
vi.mock("../store", () => ({
  upsertContacts: async (rows: unknown[], _source: string, tenantId: string) => { h.upserts.push({ rows, tenantId }); return { inserted: 1, skipped: 0 }; },
  setContactAttributes: async () => {},
  getContactByPhone: async () => ({ id: "c1", name: "Asha" }),
}));
vi.mock("../apirules", () => ({ processEvent: async (params: unknown, tenantId: string) => { h.events.push({ params, tenantId }); return h.rules; } }));
vi.mock("../autosend", () => ({ fireTrigger: async () => false }));
vi.mock("../supabase", () => ({
  db: () => ({
    from: (table: string) => {
      const chain = {
        _ids: [] as string[], _phone: "", _tenants: [] as string[],
        select() { return chain; },
        update() { return chain; },
        in(_k: string, v: string[]) { if (table === "wa_rule_sends") chain._ids = v; return chain; },
        eq(k: string, v: string) { if (k === "phone") chain._phone = v; if (k === "tenant_id") chain._tenants.push(v); return chain; },
        then(res: (v: unknown) => unknown) {
          if (table === "wa_api_rules") return Promise.resolve({ data: chain._tenants.includes("t1") ? [{ id: "r-checkout" }] : [] }).then(res);
          h.cancelled.push({ ids: chain._ids, phone: chain._phone, tenants: chain._tenants });
          return Promise.resolve({ data: [{ id: "s1" }] }).then(res);
        },
      };
      return chain;
    },
  }),
}));

const { ingestEvents } = await import("../inbound/ingest");
const integration = { id: "i1", tenantId: "t1", kind: "shopify", status: "connected" as const, config: {}, lastEventAt: null, lastEventKey: null, lastError: null, lastErrorAt: null, createdAt: "", createdBy: "" };
const order = { eventKey: "shopify.order_created", externalId: "wh-1", phone: "919876500001", name: "Asha", data: { order_name: "#1042" }, tags: ["Shopify customer"] };

beforeEach(() => {
  h.claimed.clear(); h.settled = []; h.upserts = []; h.events = []; h.cancelled = []; h.activity = [];
  h.rules = [{ rule: "Order confirmation", outcome: "scheduled" }];
});

describe("ingestEvents", () => {
  it("brings the person into the business's Contacts and runs that business's automations", async () => {
    const [r] = await ingestEvents(integration, [order]);
    expect(r).toMatchObject({ outcome: "processed", detail: "1 message scheduled." });
    expect(h.upserts).toEqual([{ rows: [expect.objectContaining({ phone: "919876500001", tags: ["Shopify customer"] })], tenantId: "t1" }]);
    expect(h.events).toEqual([{ params: { event: "shopify.order_created", phone: "919876500001", name: "Asha", payload: { order_name: "#1042" } }, tenantId: "t1" }]);
    expect(h.settled).toEqual([["t1", expect.any(String), "processed"]]);
  });

  it("acts on a retried delivery only once", async () => {
    await ingestEvents(integration, [order]);
    const [again] = await ingestEvents(integration, [order]);
    expect(again.outcome).toBe("duplicate");
    expect(h.events).toHaveLength(1);
  });

  it("logs an event with nobody to message without claiming its id", async () => {
    const [r] = await ingestEvents(integration, [{ ...order, eventKey: "shopify.checkout_started", externalId: "checkout:ck1", phone: "" }]);
    expect(r.outcome).toBe("ignored");
    // The update that carries the phone must still be processed.
    const [later] = await ingestEvents(integration, [{ ...order, eventKey: "shopify.checkout_started", externalId: "checkout:ck1" }]);
    expect(later.outcome).toBe("processed");
  });

  it("cancels the abandoned-cart reminder still waiting for someone who ordered — in that business only", async () => {
    const [r] = await ingestEvents(integration, [{ ...order, cancels: ["shopify.checkout_started"] }]);
    expect(h.cancelled).toEqual([{ ids: ["r-checkout"], phone: "919876500001", tenants: ["t1"] }]);
    expect(r.detail).toMatch(/Cancelled 1 pending message/);
  });

  it("says plainly when no automation is set up yet", async () => {
    h.rules = [];
    const [r] = await ingestEvents(integration, [order]);
    expect(r.detail).toBe("Saved to Contacts. No automation is set up for this event yet.");
  });
});
