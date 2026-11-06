// A payment the gateway reports that matches no order, or pays less than the
// order, is kept for the business to reconcile — through the real webhook path
// (markOrderPaid), not only logged.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { memdb, type MemDb } from "./helpers/memdb";

const h = vi.hoisted(() => ({ m: null as unknown as MemDb }));
vi.mock("../supabase", () => ({ db: () => h.m.client }));

import { markOrderPaid } from "../commerce";

const T = "10000000-0000-0000-0000-000000000001";
const O = "20000000-0000-0000-0000-000000000002";

beforeEach(() => {
  h.m = memdb();
  h.m.tables.wa_orders = [
    { id: "ord-1", tenant_id: T, phone: "919876500001", status: "pending", total_cents: 100000, currency: "INR", payment_ref: "plink_1", created_at: "2026-11-06T00:00:00Z" },
    { id: "ord-o", tenant_id: O, phone: "919876500002", status: "pending", total_cents: 5000, currency: "INR", payment_ref: "plink_o", created_at: "2026-11-06T00:00:00Z" },
  ];
});

const rows = () => h.m.tables.wa_unmatched_payments ?? [];

describe("payments that don't match", () => {
  it("records a payment with no order for the business whose webhook sent it, once", async () => {
    const r = await markOrderPaid({ paymentRef: "plink_unknown", providerPaymentId: "pay_9", amountPaidCents: 4200, provider: "razorpay", expectTenantId: T });
    expect(r.ok).toBe(false);
    await markOrderPaid({ paymentRef: "plink_unknown", providerPaymentId: "pay_9", amountPaidCents: 4200, provider: "razorpay", expectTenantId: T });   // webhook retry
    expect(rows()).toEqual([expect.objectContaining({ tenant_id: T, provider: "razorpay", payment_key: "pay_9", amount_cents: 4200, reason: "no_order", order_id: null })]);
  });

  it("records a short payment against its order, and leaves the order unpaid", async () => {
    const r = await markOrderPaid({ paymentRef: "plink_1", providerPaymentId: "pay_short", amountPaidCents: 50000, provider: "razorpay", expectTenantId: T });
    expect(r).toEqual({ ok: false, orderId: "ord-1" });
    expect(h.m.tables.wa_orders.find(o => o.id === "ord-1")!.status).toBe("pending");
    expect(rows()).toEqual([expect.objectContaining({ tenant_id: T, reason: "short_payment", order_id: "ord-1", amount_cents: 50000 })]);
  });

  it("files another business's order reference under the business whose gateway sent it, without touching that order", async () => {
    await markOrderPaid({ paymentRef: "plink_o", providerPaymentId: "pay_x", amountPaidCents: 5000, provider: "razorpay", expectTenantId: T });
    expect(rows()).toEqual([expect.objectContaining({ tenant_id: T, reason: "no_order", order_id: null })]);
    expect(h.m.tables.wa_orders.find(o => o.id === "ord-o")!.status).toBe("pending");
  });

  it("records nothing when no business is known (platform-wide webhook)", async () => {
    await markOrderPaid({ paymentRef: "plink_unknown", providerPaymentId: "pay_1", amountPaidCents: 100, provider: "stripe" });
    expect(rows()).toEqual([]);
  });
});
