import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ from: vi.fn(), responses: [] as unknown[], commission: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ db: () => ({ from: h.from }) }));
vi.mock("@/lib/team", () => ({ hashPassword: vi.fn() }));
vi.mock("@/lib/affiliates", () => ({ recordAffiliateCommission: h.commission }));
import {
  applySubscription, setStripeIds, setRazorpayIds,
  getTenantByStripeCustomer, getTenantByStripeSubscription, getTenantByRazorpaySubscription,
} from "@/lib/tenants";
import { recordBillingEvent, recordActualGatewayFee } from "@/lib/billing-events";

beforeEach(() => {
  vi.resetAllMocks();
  h.responses = [];
  h.from.mockImplementation(() => {
    const response = h.responses.shift();
    const chain: Record<string, unknown> = {};
    for (const method of ["update", "insert", "select", "eq", "is"]) chain[method] = vi.fn(() => chain);
    chain.single = vi.fn(async () => response);
    chain.maybeSingle = vi.fn(async () => response);
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(response).then(resolve);
    return chain;
  });
});

const databaseError = { code: "08006", message: "database unavailable" };
describe("durable billing persistence", () => {
  it.each([
    ["Stripe ids", () => setStripeIds("tenant_1", { customerId: "cus_1" })],
    ["Razorpay ids", () => setRazorpayIds("tenant_1", { subscriptionId: "sub_1" })],
    ["Stripe customer lookup", () => getTenantByStripeCustomer("cus_1")],
    ["Stripe subscription lookup", () => getTenantByStripeSubscription("sub_1")],
    ["Razorpay subscription lookup", () => getTenantByRazorpaySubscription("sub_1")],
    ["actual fee", () => recordActualGatewayFee("pay_1", 100, 18)],
  ] as const)("propagates errors for %s", async (_label, operation) => {
    h.responses.push({ data: null, error: databaseError });
    await expect(operation()).rejects.toEqual(databaseError);
  });

  it("does not record affiliate earnings after a failed tenant subscription update", async () => {
    h.responses.push({ error: databaseError });
    await expect(applySubscription("tenant_1", { paymentStatus: "active", amountCents: 100000 })).rejects.toEqual(databaseError);
    expect(h.commission).not.toHaveBeenCalled();
  });

  const charge = { provider: "razorpay" as const, providerPaymentId: "pay_1", currency: "INR", paymentMethod: "card",
    breakdown: { baseAmountCents: 100000, taxCents: 0, gatewayFeeEstimateCents: 2400, totalChargedCents: 102400 } };

  it("converges repeated payment delivery onto the existing billing event and backfills its method", async () => {
    h.responses.push({ data: null, error: { code: "23505" } }, { data: { id: "bill_1" }, error: null }, { error: null });
    await expect(recordBillingEvent("tenant_1", charge)).resolves.toBe("bill_1");
    expect(h.from).toHaveBeenCalledTimes(3);
  });

  it.each(["lookup", "method update"])("propagates a failed duplicate-charge %s so it can be retried", async (step) => {
    h.responses.push({ data: null, error: { code: "23505" } });
    if (step === "lookup") h.responses.push({ data: null, error: databaseError });
    else h.responses.push({ data: { id: "bill_1" }, error: null }, { error: databaseError });
    await expect(recordBillingEvent("tenant_1", charge)).rejects.toEqual(databaseError);
  });
});
