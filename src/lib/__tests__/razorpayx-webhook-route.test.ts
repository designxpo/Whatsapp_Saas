import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "crypto";

const h = vi.hoisted(() => ({ payout: vi.fn(async () => ({ handled: true })), validation: vi.fn(async () => ({ handled: true })) }));
vi.mock("../affiliate-payouts", () => ({ handlePayoutWebhook: h.payout, handleFundAccountValidationWebhook: h.validation }));

import { POST } from "@/app/api/webhooks/razorpayx/route";

const SECRET = "whsec_dummy";
const req = (body: string, sig?: string) => new Request("http://x/api/webhooks/razorpayx", { method: "POST", body, headers: sig === undefined ? {} : { "x-razorpay-signature": sig } });
const sign = (b: string, s = SECRET) => crypto.createHmac("sha256", s).update(b).digest("hex");

beforeEach(() => { process.env.RAZORPAYX_WEBHOOK_SECRET = SECRET; h.payout.mockClear(); h.validation.mockClear(); });
afterEach(() => { delete process.env.RAZORPAYX_WEBHOOK_SECRET; });

describe("POST /api/webhooks/razorpayx", () => {
  const body = JSON.stringify({ event: "payout.processed", payload: { payout: { entity: { id: "pout_1" } } } });
  it("fails closed with 503 when the secret is not configured", async () => {
    delete process.env.RAZORPAYX_WEBHOOK_SECRET;
    expect((await POST(req(body, sign(body)))).status).toBe(503); expect(h.payout).not.toHaveBeenCalled();
  });
  it("401 on a missing or wrong signature, without processing", async () => {
    expect((await POST(req(body))).status).toBe(401);
    expect((await POST(req(body, sign(body, "wrong")))).status).toBe(401);
    expect((await POST(req(body + " ", sign(body)))).status).toBe(401);
    expect(h.payout).not.toHaveBeenCalled();
  });
  it("routes payout.* and fund_account.validation.* after a valid signature", async () => {
    expect((await POST(req(body, sign(body)))).status).toBe(200); expect(h.payout).toHaveBeenCalledTimes(1);
    const v = JSON.stringify({ event: "fund_account.validation.completed", payload: {} });
    expect((await POST(req(v, sign(v)))).status).toBe(200); expect(h.validation).toHaveBeenCalledTimes(1);
  });
  it("answers 200 even when processing throws", async () => {
    h.payout.mockRejectedValueOnce(new Error("db down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await POST(req(body, sign(body)))).status).toBe(200); spy.mockRestore();
  });
  it("400 on a signed but non-JSON body", async () => {
    expect((await POST(req("not json", sign("not json")))).status).toBe(400);
  });
});
