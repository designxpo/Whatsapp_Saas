import { describe, it, expect, vi, beforeEach } from "vitest";

// End-to-end pass of an Amazon-style order lifecycle through the API rules
// engine: one generic event per status change, each fanning out to the right
// template with the right variables and a per-order deep link on its button.
//
// Runs against a stubbed wa_api_rules table rather than the real database —
// the point is to prove the resolution path, not to write rows into production.

const RULES = [
  {
    id: "r1", name: "Order out for delivery", active: true, event_key: "order_shipped",
    conditions: [], template_name: "order_on_the_way", language_code: "en_US",
    // "Your Amazon Now order: {{1}} is on the way. Arriving in {{2}} mins"
    variables: ["{{payload.order_id}}", "{{payload.eta_minutes}}"],
    // "Track your delivery" → https://shop.example/track/{{1}}
    button_url_params: ["{{payload.order_id}}"],
    header_image_url: null, delay_value: 0, delay_unit: "minutes",
    window_start_hour: null, window_end_hour: null, frequency_cap_hours: 0,
    channel_id: null, tenant_id: "t1", created_at: "2026-08-01T00:00:00Z", campaign_id: "c1",
  },
  {
    id: "r2", name: "Order delivered", active: true, event_key: "order_delivered",
    conditions: [], template_name: "order_delivered", language_code: "en_US",
    variables: ["{{payload.order_id}}", "{{payload.minutes_taken}}"],
    button_url_params: ["{{payload.order_id}}"],          // "View Order Details"
    header_image_url: null, delay_value: 0, delay_unit: "minutes",
    window_start_hour: null, window_end_hour: null, frequency_cap_hours: 0,
    channel_id: null, tenant_id: "t1", created_at: "2026-08-01T00:00:00Z", campaign_id: "c2",
  },
  {
    id: "r3", name: "Order cancelled", active: true, event_key: "order_cancelled",
    conditions: [], template_name: "order_cancelled", language_code: "en_US",
    variables: ["{{payload.order_id}}"],
    // Two buttons: "Order Again" (per-order) and "Contact Support" (fixed link,
    // so no value at index 1 — it must stay absent, not empty-but-present).
    button_url_params: ["{{payload.order_id}}"],
    header_image_url: null, delay_value: 0, delay_unit: "minutes",
    window_start_hour: null, window_end_hour: null, frequency_cap_hours: 0,
    channel_id: null, tenant_id: "t1", created_at: "2026-08-01T00:00:00Z", campaign_id: "c3",
  },
  {
    id: "r4", name: "Refund issued", active: true, event_key: "refund_issued",
    conditions: [], template_name: "refund_issued", language_code: "en_US",
    variables: ["{{payload.amount}}", "{{payload.order_id}}", "{{payload.eta_days}}"],
    button_url_params: ["{{payload.order_id}}"],          // "REFUND DETAILS"
    header_image_url: null, delay_value: 0, delay_unit: "minutes",
    window_start_hour: null, window_end_hour: null, frequency_cap_hours: 0,
    channel_id: null, tenant_id: "t1", created_at: "2026-08-01T00:00:00Z", campaign_id: "c4",
  },
  {
    // High-value orders only — proves conditions gate the same event.
    id: "r5", name: "Premium delivery thanks", active: true, event_key: "order_delivered",
    conditions: [{ source: "payload", key: "total", op: "gt", value: "1000" }],
    template_name: "premium_thanks", language_code: "en_US",
    variables: ["{{contact.name}}"], button_url_params: [],
    header_image_url: null, delay_value: 2, delay_unit: "hours",
    window_start_hour: null, window_end_hour: null, frequency_cap_hours: 0,
    channel_id: null, tenant_id: "t1", created_at: "2026-08-01T00:00:00Z", campaign_id: "c5",
  },
];

// Minimal chainable stub of the query builder processEvent uses: every method
// returns the chain, and awaiting it yields the rows for that table. Only
// `event_key` is honoured — enough for the engine to select the right rules,
// which is what these tests are actually about.
interface Chain extends PromiseLike<unknown> {
  select: () => Chain;
  eq: (col: string, val: unknown) => Chain;
  in: () => Chain;
  gte: () => Chain;
}

function stubDb() {
  return {
    from(table: string): Chain {
      let eventKey = "";
      const chain: Chain = {
        select: () => chain,
        eq: (col, val) => { if (col === "event_key") eventKey = String(val); return chain; },
        in: () => chain,
        gte: () => chain,
        then: (onfulfilled) => Promise.resolve(
          table === "wa_api_rules"
            ? { data: RULES.filter(r => r.event_key === eventKey && r.active), error: null }
            : { data: [], error: null, count: 0 },
        ).then(onfulfilled),
      };
      return chain;
    },
  };
}

vi.mock("@/lib/supabase", () => ({ db: () => stubDb() }));
vi.mock("@/lib/store", () => ({
  getContactByPhone: async () => ({ id: "ct1", name: "Asha", phone: "919876543210", attributes: {}, tags: [] }),
  createCampaign: async () => ({ id: "c-new" }),
  dailySentCount: async () => 0,
}));
vi.mock("@/lib/whatsapp", () => ({
  sendCampaign: async () => ({ sentCount: 1, failedCount: 0, skippedCount: 0, errors: [], results: [] }),
  fetchTemplates: async () => [],
  dynamicUrlButtonIndexes: () => [],
}));
vi.mock("@/lib/channels", () => ({ credsFor: async () => undefined }));
vi.mock("@/lib/links", () => ({ getTrackedUrls: async () => [] }));
vi.mock("@/lib/quota", () => ({ getDailyCap: async () => 1000 }));

import { processEvent } from "@/lib/apirules";

const PHONE = "919876543210";
const fire = (event: string, data: Record<string, unknown>) =>
  processEvent({ event, phone: PHONE, name: "Asha", payload: data, dryRun: true }, "t1");

beforeEach(() => vi.clearAllMocks());

describe("Amazon-style order lifecycle over /api/events", () => {
  it("'on the way' fills the body and deep-links the track button to that order", async () => {
    const [r] = await fire("order_shipped", { order_id: "404-0952515-9776314", eta_minutes: 10 });
    expect(r.outcome).toBe("dry_run_match");
    expect(r.variables).toEqual(["404-0952515-9776314", "10"]);
    expect(r.buttonUrlParams).toEqual(["404-0952515-9776314"]);
  });

  it("'delivered' carries the elapsed time and its own order link", async () => {
    const results = await fire("order_delivered", { order_id: "404-0952515-9776314", minutes_taken: 26, total: 499 });
    const delivered = results.find(x => x.rule === "Order delivered");
    expect(delivered?.variables).toEqual(["404-0952515-9776314", "26"]);
    expect(delivered?.buttonUrlParams).toEqual(["404-0952515-9776314"]);
  });

  it("gates the premium follow-up on order value, and delays it", async () => {
    const cheap = await fire("order_delivered", { order_id: "x", minutes_taken: 5, total: 499 });
    expect(cheap.find(r => r.rule === "Premium delivery thanks")?.outcome).toBe("skipped");

    const rich = await fire("order_delivered", { order_id: "x", minutes_taken: 5, total: 2400 });
    const premium = rich.find(r => r.rule === "Premium delivery thanks");
    expect(premium?.outcome).toBe("dry_run_match");
    expect(premium?.variables).toEqual(["Asha"]);          // resolved off the contact, not the payload
    // Delayed two hours rather than fired alongside the delivery notice.
    expect(new Date(premium!.sendAfter!).getTime() - Date.now()).toBeGreaterThan(1.9 * 3600_000);
  });

  it("'cancelled' supplies only the per-order button, leaving the fixed support link alone", async () => {
    const [r] = await fire("order_cancelled", { order_id: "402-9904090-8729106" });
    expect(r.variables).toEqual(["402-9904090-8729106"]);
    // One entry only — a second would be sent for "Contact Support", which is a
    // fixed link, and Meta rejects a parameter for a non-dynamic button.
    expect(r.buttonUrlParams).toEqual(["402-9904090-8729106"]);
  });

  it("'refund issued' formats amount, order and ETA in template order", async () => {
    const [r] = await fire("refund_issued", { amount: "435.53", order_id: "404-8947437-8126715", eta_days: "3-5" });
    expect(r.variables).toEqual(["435.53", "404-8947437-8126715", "3-5"]);
    expect(r.buttonUrlParams).toEqual(["404-8947437-8126715"]);
  });

  it("does nothing for an event no rule listens to", async () => {
    expect(await fire("order_returned_to_seller", { order_id: "x" })).toEqual([]);
  });

  it("resolves a missing payload field to empty rather than leaking the raw token", async () => {
    // A live-but-broken link (…/track/{{payload.order_id}}) is worse than a
    // caught blank, which the save-time guard is there to prevent shipping.
    const [r] = await fire("order_shipped", { eta_minutes: 10 });
    expect(r.buttonUrlParams).toEqual([""]);
    expect(r.variables?.[0]).toBe("");
  });
});
