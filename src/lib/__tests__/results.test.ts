// Phase 5 "business results": where paying customers came from (saved on the
// order at checkout), ads → leads → qualified → paid, broadcasts → orders in
// the following week (attributed), social comments → sales, whether the AI's
// "ready to pay" came true, and what's slipping. Synthetic data.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memdb, type MemDb } from "./helpers/memdb";

const h = vi.hoisted(() => ({ m: null as unknown as MemDb, handoffs: {} as Record<string, unknown> }));

vi.mock("../supabase", () => ({ db: () => h.m.client }));
vi.mock("../tenantdb", () => ({
  tdb: (t: string) => ({
    from: (tb: string) => {
      const b = h.m.client.from(tb) as Record<string, (...a: unknown[]) => unknown>;
      const ins = b.insert;
      b.insert = (p: unknown) => ins(Array.isArray(p) ? p.map(x => ({ ...(x as object), tenant_id: t })) : { ...(p as object), tenant_id: t });
      return (b.eq as (c: string, v: string) => unknown)("tenant_id", t);
    },
  }),
}));
vi.mock("../handoff", () => ({ listHandoffs: async (_t: string, q: { platform: string }) => (h.handoffs[q.platform] ? { rows: [], next: null, summary: h.handoffs[q.platform] } : { rows: [], next: null, summary: { sent: 0, started: 0, orders: 0, revenueCents: 0 } }) }));
vi.mock("../integrations", () => ({ emitEvent: async () => undefined, createPaymentLink: async () => ({ id: "plink_1", url: "https://rzp.io/l/1" }) }));
vi.mock("../sequences", () => ({ getSequenceByTrigger: async () => null, enroll: async () => undefined }));

import { sourceFromAttributes } from "../order-source";
import { checkoutCart } from "../commerce";
import { resultsReport } from "../results";

const T = "10000000-0000-0000-0000-000000000001";
const O = "20000000-0000-0000-0000-000000000002";
const NOW = Date.parse("2026-11-06T06:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); h.m = memdb(); h.handoffs = {}; });
afterEach(() => vi.useRealTimers());

describe("where a customer came from", () => {
  it("reads it from the attribution already on the contact, most specific first", () => {
    expect(sourceFromAttributes({ ad_id: "120", ad_headline: "Diwali thali", utm_source: "google" })).toEqual({ channel: "Meta ad", detail: "Diwali thali", adId: "120", campaign: null });
    expect(sourceFromAttributes({ utm_source: "google", utm_medium: "cpc", utm_campaign: "brand" })).toMatchObject({ channel: "Paid search / ads", detail: "google / cpc", campaign: "brand" });
    expect(sourceFromAttributes({ utm_source: "newsletter" }).channel).toBe("Website & campaigns");
    expect(sourceFromAttributes({ gclid: "x" }).channel).toBe("Paid search / ads");
    expect(sourceFromAttributes({ handle_source: "Shop counter QR" })).toMatchObject({ channel: "Links & QR codes", detail: "Shop counter QR" });
    expect(sourceFromAttributes({}, "growth").channel).toBe("Growth tools");
    expect(sourceFromAttributes(null, "inbound").channel).toBe("Direct / unknown");
  });

  it("is saved on the order at checkout", async () => {
    h.m.tables.contacts = [{ id: "k1", tenant_id: T, phone: "919876500001", attributes: { ad_id: "120", ad_headline: "Diwali thali" }, opt_in_source: "inbound" }];
    h.m.tables.wa_carts = [{ id: "cart1", tenant_id: T, phone: "919876500001", status: "open", items: [{ productId: "p", name: "Thali", priceCents: 49900, qty: 2 }] }];
    const r = await checkoutCart({ phone: "919876500001" }, T);
    expect(r).toMatchObject({ totalCents: 99800, paymentUrl: "https://rzp.io/l/1" });
    expect(h.m.tables.wa_orders[0]).toMatchObject({ source: { channel: "Meta ad", detail: "Diwali thali", adId: "120" }, payment_url: "https://rzp.io/l/1" });
  });
});

describe("the results report", () => {
  beforeEach(() => {
    const t = h.m.tables;
    t.contacts = [
      { tenant_id: T, phone: "919876500001", attributes: { ad_id: "120", ad_headline: "Diwali thali" }, created_at: daysAgo(10) },
      { tenant_id: T, phone: "919876500002", attributes: { ad_id: "120", ad_headline: "Diwali thali" }, created_at: daysAgo(9) },
      { tenant_id: T, phone: "919876500003", attributes: { ad_id: "121", ad_headline: "Weekend brunch" }, created_at: daysAgo(5) },
      { tenant_id: T, phone: "919876500004", attributes: { handle_source: "Counter QR" }, created_at: daysAgo(40) },
      { tenant_id: T, phone: "919876500005", attributes: {}, created_at: daysAgo(3) },
      { tenant_id: O, phone: "919876500001", attributes: { ad_id: "999" }, created_at: daysAgo(2) },
    ];
    t.wa_conversations = [
      { tenant_id: T, phone: "919876500002", lead_status: "Hot", ready_to_pay: false, lead_scored_at: daysAgo(8) },
      { tenant_id: T, phone: "919876500005", lead_status: "Warm", ready_to_pay: true, lead_scored_at: daysAgo(2) },
    ];
    const order = (id: string, phone: string, cents: number, at: string, x: Record<string, unknown> = {}) => ({ id, tenant_id: T, phone, total_cents: cents, currency: "INR", status: "paid", paid_at: at, created_at: at, source: null, ...x });
    t.wa_orders = [
      order("o1", "919876500001", 100000, daysAgo(7), { source: { channel: "Meta ad", detail: "Diwali thali", adId: "120" } }),
      order("o2", "919876500004", 50000, daysAgo(6)),                                   // older order without a saved source
      order("o3", "919876500003", 20000, daysAgo(1), { status: "fulfilled", source: { channel: "Meta ad", detail: "Weekend brunch" } }),
      order("o-old", "919876500001", 90000, daysAgo(45)),                                // outside the period
      order("o-ref", "919876500001", 5000, daysAgo(2), { status: "refunded" }),          // refunded: not counted
      order("o-unpaid", "919876500005", 30000, daysAgo(3), { status: "pending", paid_at: null }),
      order("o-x", "919876500001", 777700, daysAgo(2), { tenant_id: O }),
    ];
    t.wa_send_log = [
      { tenant_id: T, campaign_id: "camp1", phone: "919876500001", status: "read", sent_at: daysAgo(9) },     // bought 2 days later → counts
      { tenant_id: T, campaign_id: "camp1", phone: "919876500004", status: "delivered", sent_at: daysAgo(20) }, // bought 14 days later → doesn't
      { tenant_id: T, campaign_id: "camp1", phone: "919876500003", status: "failed", sent_at: daysAgo(3) },    // never reached
      { tenant_id: T, campaign_id: "camp2", phone: "919876500003", status: "sent", sent_at: daysAgo(0.5) },    // bought BEFORE it → doesn't
    ];
    t.wa_campaigns = [{ id: "camp1", tenant_id: T, name: "Diwali offer" }, { id: "camp2", tenant_id: T, name: null, template_name: "brunch_promo" }];
    t.wa_lead_reads = [
      { tenant_id: T, phone: "919876500001", status: "Hot", ready_to_pay: true, created_at: daysAgo(8) },   // paid a day later ✓
      { tenant_id: T, phone: "919876500005", status: "Warm", ready_to_pay: true, created_at: daysAgo(2) },  // hasn't paid
      { tenant_id: T, phone: "919876500003", status: "Cold", ready_to_pay: false, created_at: daysAgo(4) }, // paid anyway
    ];
    h.handoffs.instagram = { sent: 40, started: 12, orders: 3, revenueCents: 150000 };
  });

  it("adds up revenue by source, falling back to the customer's record for older orders", async () => {
    const r = await resultsReport(T, 30, NOW);
    expect(r).toMatchObject({ revenueCents: 170000, paidOrders: 3, currency: "INR" });
    expect(r.bySource).toEqual([
      { channel: "Meta ad", orders: 2, revenueCents: 120000, fromCustomerRecord: 0 },
      { channel: "Links & QR codes", orders: 1, revenueCents: 50000, fromCustomerRecord: 1 },
    ]);
  });

  it("follows each ad from lead to qualified to paid", async () => {
    const r = await resultsReport(T, 30, NOW);
    expect(r.ads).toEqual([
      { adId: "120", name: "Diwali thali", leads: 2, qualified: 2, paidCustomers: 1, revenueCents: 100000 },
      { adId: "121", name: "Weekend brunch", leads: 1, qualified: 1, paidCustomers: 1, revenueCents: 20000 },
    ]);
  });

  it("credits a broadcast only with orders in the 7 days after it reached someone", async () => {
    const r = await resultsReport(T, 30, NOW);
    expect(r.broadcasts).toEqual([
      { campaignId: "camp1", name: "Diwali offer", reached: 2, buyers: 1, revenueCents: 100000 },
      { campaignId: "camp2", name: "brunch_promo", reached: 1, buyers: 0, revenueCents: 0 },
    ]);
  });

  it("reports social sales, how often the AI was right, and what's slipping", async () => {
    const r = await resultsReport(T, 30, NOW);
    expect(r.social).toEqual([{ platform: "instagram", invites: 40, chats: 12, orders: 3, revenueCents: 150000 }]);
    expect(r.aiReads).toEqual({ readyToPay: 2, paidWithin14Days: 1, notReadyButPaid: 1 });
    expect(r.missed).toEqual({ readyNotPaid: 1, unpaidOrders: 1, unpaidValueCents: 30000 });
  });

  it("narrows to the period chosen", async () => {
    const r = await resultsReport(T, 7, NOW);
    expect(r.paidOrders).toBe(3);                 // o1 (exactly 7 days — the boundary counts), o2, o3; not the 45-day-old one
    expect((await resultsReport(T, 7, NOW + 60_000)).paidOrders).toBe(2);   // a minute later o1 drops out
    expect(r.ads.map(a => a.adId)).toEqual(["121"]);
  });
});
