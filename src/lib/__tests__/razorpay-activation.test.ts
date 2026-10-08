import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  requireRoleAdmin: vi.fn(), currentTenantId: vi.fn(), getTenant: vi.fn(), applySubscription: vi.fn(),
  verifySubscriptionSignature: vi.fn(), getSubscriptionDetail: vi.fn(), getPlan: vi.fn(), recordBillingEvent: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ requireRoleAdmin: h.requireRoleAdmin, currentTenantId: h.currentTenantId, DEFAULT_TENANT_ID: "default" }));
vi.mock("@/lib/tenants", () => ({ getTenant: h.getTenant, applySubscription: h.applySubscription }));
vi.mock("@/lib/razorpay", () => ({ verifySubscriptionSignature: h.verifySubscriptionSignature, getSubscriptionDetail: h.getSubscriptionDetail }));
vi.mock("@/lib/plans", () => ({ getPlan: h.getPlan }));
vi.mock("@/lib/billing-events", () => ({ recordBillingEvent: h.recordBillingEvent }));
import { POST } from "@/app/api/admin/billing/razorpay/verify/route";

const request = () => new Request("https://app.example.test/api/admin/billing/razorpay/verify", {
  method: "POST", body: JSON.stringify({ razorpay_payment_id: "pay_1", razorpay_subscription_id: "sub_1", razorpay_signature: "signed" }),
});
beforeEach(() => {
  vi.resetAllMocks();
  h.requireRoleAdmin.mockResolvedValue(true);
  h.currentTenantId.mockResolvedValue("tenant_1");
  h.getTenant.mockResolvedValue({ id: "tenant_1", razorpaySubscriptionId: "sub_1" });
  h.verifySubscriptionSignature.mockReturnValue(true);
  h.getSubscriptionDetail.mockResolvedValue({ status: "active", paidCount: 1, planKey: "growth", amountCents: 102400, currency: "INR", currentPeriodEnd: "2027-01-01T00:00:00Z" });
  h.getPlan.mockResolvedValue({ key: "growth", priceCents: 100000 });
  h.recordBillingEvent.mockResolvedValue("bill_1");
});

describe("Razorpay initial paid activation", () => {
  it.each([
    ["authenticated", 0], ["created", 0], ["pending", 1], ["active", 0], ["cancelled", 1],
  ])("keeps checkout pending without granting paid access (%s, paid cycles %s)", async (status, paidCount) => {
    h.getSubscriptionDetail.mockResolvedValue({ status, paidCount });
    const response = await POST(request());
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ success: true, pending: true });
    expect(h.applySubscription).not.toHaveBeenCalled();
    expect(h.recordBillingEvent).not.toHaveBeenCalled();
  });

  it("activates the provider-confirmed paid subscription belonging to the tenant", async () => {
    expect((await POST(request())).status).toBe(200);
    expect(h.applySubscription).toHaveBeenCalledWith("tenant_1", expect.objectContaining({ plan: "growth", paymentStatus: "active", subscriptionId: "sub_1" }));
    expect(h.recordBillingEvent).toHaveBeenCalledWith("tenant_1", expect.objectContaining({ providerPaymentId: "pay_1" }));
  });

  it("does not read or activate another tenant's signed subscription", async () => {
    h.getTenant.mockResolvedValue({ id: "tenant_1", razorpaySubscriptionId: "sub_other" });
    expect((await POST(request())).status).toBe(400);
    expect(h.getSubscriptionDetail).not.toHaveBeenCalled();
    expect(h.applySubscription).not.toHaveBeenCalled();
  });
});
