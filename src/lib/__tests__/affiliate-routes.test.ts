import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";

const h = vi.hoisted(() => ({
  owner: false,
  lib: {
    listOwnerPayoutData: vi.fn(async () => ({ payouts: [] })), approvePayout: vi.fn(async () => ({ status: "processing", rzpPayoutId: "p" })),
    rejectPayout: vi.fn(async () => {}), createPayoutRequest: vi.fn(async () => "pid"), ownerClearFlag: vi.fn(async () => {}),
    ownerSetRiskHold: vi.fn(async () => {}), ownerVerifyPayoutAccount: vi.fn(async () => {}), applyPaymentReversal: vi.fn(async () => "voided"),
    getManualPaymentInstructions: vi.fn(async () => ({ vpa: "a@b" })), recordManualPayment: vi.fn(async () => {}),
    cancelManualPayout: vi.fn(async () => {}), getVerificationDetails: vi.fn(async () => ({ vpa: "a@b" })),
  },
  apply: vi.fn(async () => {}),
}));
vi.mock("@/lib/auth", () => ({ isPlatformOwner: async () => h.owner, currentUser: async () => ({ email: "owner@x" }), currentAffiliate: async () => null }));
vi.mock("@/lib/affiliate-payouts", () => ({ ...h.lib, PayoutError: class extends Error {} }));
vi.mock("@/lib/tenants", () => ({ applySubscription: h.apply, getTenantByRazorpaySubscription: async () => ({ id: "T1", plan: "growth" }), getTenant: async () => null }));
vi.mock("@/lib/plans", () => ({ getPlan: async () => ({ priceCents: 500000 }) }));
vi.mock("@/lib/billing-events", () => ({ recordBillingEvent: async () => null, recordActualGatewayFee: async () => {} }));
vi.mock("@/lib/invoice-email", () => ({ sendInvoiceEmail: async () => {} }));
vi.mock("@/lib/dunning", () => ({ notifyPaymentFailed: async () => {}, notifyServiceSuspended: async () => {} }));
vi.mock("@/lib/billing-cancel", () => ({ recordCancelAt: async () => {} }));

import { GET as listGET } from "@/app/api/owner/affiliate-payouts/route";
import { POST as approve } from "@/app/api/owner/affiliate-payouts/approve/route";
import { POST as reject } from "@/app/api/owner/affiliate-payouts/reject/route";
import { POST as createReq } from "@/app/api/owner/affiliate-payouts/create-request/route";
import { POST as clearFlag } from "@/app/api/owner/affiliate-payouts/clear-flag/route";
import { POST as riskHold } from "@/app/api/owner/affiliate-payouts/risk-hold/route";
import { POST as verifyAcct } from "@/app/api/owner/affiliate-payouts/verify-account/route";
import { POST as manualInstr } from "@/app/api/owner/affiliate-payouts/manual-instructions/route";
import { POST as recordPay } from "@/app/api/owner/affiliate-payouts/record-payment/route";
import { POST as cancelManual } from "@/app/api/owner/affiliate-payouts/cancel-manual/route";
import { POST as verifyDetails } from "@/app/api/owner/affiliate-payouts/verification-details/route";
import { POST as subsWebhook } from "@/app/api/webhooks/razorpay/subscriptions/route";

const json = (b: unknown) => new Request("http://x", { method: "POST", body: JSON.stringify(b) });
const ID = "00000000-0000-4000-8000-0000000000a1";

beforeEach(() => { h.owner = false; for (const f of Object.values(h.lib)) f.mockClear(); h.apply.mockClear(); });

describe("owner affiliate-payout routes are owner-only", () => {
  it("403 for everyone else, and nothing is called", async () => {
    expect((await listGET()).status).toBe(403);
    for (const [r, b] of [[approve, { payoutId: ID }], [reject, { payoutId: ID }], [createReq, { affiliateId: ID }], [clearFlag, { commissionId: ID, note: "n" }], [riskHold, { affiliateId: ID, hold: true }], [verifyAcct, { affiliateId: ID, note: "n" }],
      [manualInstr, { payoutId: ID }], [recordPay, { payoutId: ID, utr: "412356789012" }], [cancelManual, { payoutId: ID, reason: "r", confirmation: "NOT PAID" }], [verifyDetails, { affiliateId: ID }]] as const) {
      expect((await r(json(b))).status).toBe(403);
    }
    for (const f of Object.values(h.lib)) expect(f).not.toHaveBeenCalled();
  });
  it("owner reaches the library with their own email as actor, and ids are validated", async () => {
    h.owner = true;
    expect((await approve(json({ payoutId: "not-a-uuid" }))).status).toBe(400);
    expect((await approve(json({ payoutId: ID }))).status).toBe(200);
    expect(h.lib.approvePayout).toHaveBeenCalledWith(ID, "owner@x");
    expect((await riskHold(json({ affiliateId: ID, hold: "yes" }))).status).toBe(400);
  });
  it("payment and verification details are never cached", async () => {
    h.owner = true;
    for (const r of [await manualInstr(json({ payoutId: ID })), await verifyDetails(json({ affiliateId: ID }))]) {
      expect(r.status).toBe(200);
      expect(r.headers.get("Cache-Control")).toBe("no-store");
    }
    expect(h.lib.getManualPaymentInstructions).toHaveBeenCalledWith(ID, "owner@x");
    expect(h.lib.getVerificationDetails).toHaveBeenCalledWith(ID, "owner@x");
  });
});

describe("razorpay subscriptions webhook", () => {
  const SECRET = "dummy_sub_secret";
  const send = (event: unknown) => { const raw = JSON.stringify(event); return subsWebhook(new Request("http://x", { method: "POST", body: raw, headers: { "x-razorpay-signature": crypto.createHmac("sha256", SECRET).update(raw).digest("hex") } })); };
  beforeEach(() => { process.env.RAZORPAY_SUBSCRIPTIONS_WEBHOOK_SECRET = SECRET; });
  it("passes the Razorpay payment id into applySubscription on subscription.charged", async () => {
    await send({ event: "subscription.charged", payload: { subscription: { entity: { id: "sub_1", current_end: 1800000000 } }, payment: { entity: { id: "pay_77", amount: 590000, currency: "INR" } } } });
    expect(h.apply).toHaveBeenCalledTimes(1);
    expect((h.apply.mock.calls[0] as unknown[])[1]).toMatchObject({ providerPaymentId: "pay_77" });
  });
  it("routes refund and dispute events to the commission reversal, not the subscription path", async () => {
    expect((await send({ event: "refund.processed", payload: { refund: { entity: { payment_id: "pay_77", amount: 590000 } }, payment: { entity: { id: "pay_77", amount: 590000 } } } })).status).toBe(200);
    expect(h.lib.applyPaymentReversal).toHaveBeenCalledWith({ paymentId: "pay_77", event: "refund", refundAmount: 590000, paymentAmount: 590000 });
    await send({ event: "payment.dispute.lost", payload: { dispute: { entity: { payment_id: "pay_78" } } } });
    expect(h.lib.applyPaymentReversal).toHaveBeenLastCalledWith(expect.objectContaining({ paymentId: "pay_78", event: "dispute_lost" }));
    expect(h.apply).not.toHaveBeenCalled();
  });
  it("returns 500 (so Razorpay retries) if a reversal fails", async () => {
    h.lib.applyPaymentReversal.mockRejectedValueOnce(new Error("db down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await send({ event: "refund.processed", payload: { refund: { entity: { payment_id: "pay_1" } } } })).status).toBe(500); spy.mockRestore();
  });
});
