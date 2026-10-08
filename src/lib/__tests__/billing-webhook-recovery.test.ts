import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  verifyWebhook: vi.fn(), verifyRazorpayWebhook: vi.fn(),
  applySubscription: vi.fn(), setStripeIds: vi.fn(), getTenant: vi.fn(),
  getTenantByStripeCustomer: vi.fn(), getTenantByRazorpaySubscription: vi.fn(),
  getPlanByStripePrice: vi.fn(), getPlan: vi.fn(), markOrderPaid: vi.fn(),
  recordBillingEvent: vi.fn(), recordActualGatewayFee: vi.fn(), sendInvoiceEmail: vi.fn(),
  notifyPaymentFailed: vi.fn(), notifyServiceSuspended: vi.fn(),
}));

vi.mock("@/lib/stripe", () => ({ verifyWebhook: h.verifyWebhook }));
vi.mock("@/lib/razorpay", () => ({ verifyRazorpayWebhook: h.verifyRazorpayWebhook }));
vi.mock("@/lib/tenants", () => ({
  applySubscription: h.applySubscription, setStripeIds: h.setStripeIds,
  getTenant: h.getTenant, getTenantByStripeCustomer: h.getTenantByStripeCustomer,
  getTenantByRazorpaySubscription: h.getTenantByRazorpaySubscription,
}));
vi.mock("@/lib/plans", () => ({ getPlan: h.getPlan, getPlanByStripePrice: h.getPlanByStripePrice }));
vi.mock("@/lib/commerce", () => ({ markOrderPaid: h.markOrderPaid }));
vi.mock("@/lib/billing-events", () => ({ recordBillingEvent: h.recordBillingEvent, recordActualGatewayFee: h.recordActualGatewayFee }));
vi.mock("@/lib/invoice-email", () => ({ sendInvoiceEmail: h.sendInvoiceEmail }));
vi.mock("@/lib/dunning", () => ({ notifyPaymentFailed: h.notifyPaymentFailed, notifyServiceSuspended: h.notifyServiceSuspended }));

import { POST as stripePost } from "@/app/api/webhooks/stripe/route";
import { POST as razorpayPost } from "@/app/api/webhooks/razorpay/subscriptions/route";

const razorpayCharge = {
  event: "subscription.charged",
  payload: {
    subscription: { entity: { id: "sub_rzp", current_end: 1800000000, notes: { plan: "growth" } } },
    payment: { entity: { id: "pay_1", amount: 102400, currency: "INR", status: "captured", fee: 2048, tax: 369, method: "card" } },
  },
};
const request = (body: unknown = {}) => new Request("https://app.example.test/api/webhooks", {
  method: "POST", body: JSON.stringify(body), headers: { "stripe-signature": "signed", "x-razorpay-signature": "signed" },
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("RAZORPAY_SUBSCRIPTIONS_WEBHOOK_SECRET", "test-signing-secret");
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.verifyRazorpayWebhook.mockReturnValue(true);
  h.getTenantByRazorpaySubscription.mockResolvedValue({ id: "tenant_1", plan: "starter" });
  h.getPlan.mockResolvedValue({ key: "growth", priceCents: 100000 });
  h.recordBillingEvent.mockResolvedValue("bill_1");
  h.sendInvoiceEmail.mockResolvedValue(undefined);
  h.verifyWebhook.mockReturnValue({
    type: "customer.subscription.updated", data: { object: {
      id: "sub_stripe", metadata: { tenant_id: "tenant_1" }, customer: "cus_1", status: "active",
      items: { data: [{ price: { id: "price_growth", unit_amount: 100000, currency: "inr" }, current_period_end: 1800000000 }] },
    } },
  });
  h.getPlanByStripePrice.mockResolvedValue({ key: "growth" });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("billing webhook recovery", () => {
  it("requests Stripe redelivery after a tenant write fails, then acknowledges successful reconciliation", async () => {
    h.applySubscription.mockRejectedValueOnce(new Error("database unavailable"));
    expect((await stripePost(request())).status).toBe(503);
    expect((await stripePost(request())).status).toBe(200);
    expect(h.applySubscription).toHaveBeenCalledTimes(2);
  });

  it("requests Stripe redelivery if checkout identifiers cannot be persisted", async () => {
    h.verifyWebhook.mockReturnValue({ type: "checkout.session.completed", data: { object: {
      mode: "subscription", metadata: { tenant_id: "tenant_1" }, customer: "cus_1", subscription: "sub_1",
    } } });
    h.setStripeIds.mockRejectedValue(new Error("database unavailable"));
    expect((await stripePost(request())).status).toBe(503);
  });

  it.each(["tenant", "billing event", "actual fee"])("requests Razorpay redelivery on a failed %s write", async (step) => {
    const failure = new Error("database unavailable");
    if (step === "tenant") h.applySubscription.mockRejectedValueOnce(failure);
    if (step === "billing event") h.recordBillingEvent.mockRejectedValueOnce(failure);
    if (step === "actual fee") h.recordActualGatewayFee.mockRejectedValueOnce(failure);
    expect((await razorpayPost(request(razorpayCharge))).status).toBe(503);
    expect(h.sendInvoiceEmail).not.toHaveBeenCalled();
    expect((await razorpayPost(request(razorpayCharge))).status).toBe(200);
    expect(h.sendInvoiceEmail).toHaveBeenCalledWith("bill_1");
  });

  it("applies the purchased Razorpay plan even when the browser confirmation is missed", async () => {
    expect((await razorpayPost(request(razorpayCharge))).status).toBe(200);
    expect(h.applySubscription).toHaveBeenCalledWith("tenant_1", expect.objectContaining({ plan: "growth", paymentStatus: "active" }));
    expect(h.recordBillingEvent).toHaveBeenCalledWith("tenant_1", expect.objectContaining({ providerPaymentId: "pay_1", paymentMethod: "card" }));
    expect(h.recordActualGatewayFee).toHaveBeenCalledWith("pay_1", 2048, 369);
    expect(h.recordActualGatewayFee.mock.invocationCallOrder[0]).toBeLessThan(h.sendInvoiceEmail.mock.invocationCallOrder[0]);
  });

  it("keeps email delivery best-effort after financial state is durable", async () => {
    h.sendInvoiceEmail.mockRejectedValue(new Error("email unavailable"));
    expect((await razorpayPost(request(razorpayCharge))).status).toBe(200);
  });

  it("rejects an invalid Razorpay signature without touching financial state", async () => {
    h.verifyRazorpayWebhook.mockReturnValue(false);
    expect((await razorpayPost(request(razorpayCharge))).status).toBe(401);
    expect(h.applySubscription).not.toHaveBeenCalled();
  });

  it("does not grant paid access on mandate authentication alone", async () => {
    expect((await razorpayPost(request({ ...razorpayCharge, event: "subscription.authenticated" }))).status).toBe(200);
    expect(h.applySubscription).not.toHaveBeenCalled();
    expect(h.recordBillingEvent).not.toHaveBeenCalled();
  });

  it.each(["authorized", "failed", undefined])("requires captured payment evidence before activating a charged event (%s)", async (status) => {
    const payload = { ...razorpayCharge, payload: { ...razorpayCharge.payload,
      payment: { entity: { ...razorpayCharge.payload.payment.entity, status } },
    } };
    expect((await razorpayPost(request(payload))).status).toBe(400);
    expect(h.applySubscription).not.toHaveBeenCalled();
    expect(h.recordBillingEvent).not.toHaveBeenCalled();
  });
});
