import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import { verifyRazorpayXWebhook, createPayout, createFundAccount, assertRazorpayxConfigured, payoutModeFor, RazorpayXError } from "../razorpayx";

const SECRET = "whsec_dummy";
const sign = (body: string, s = SECRET) => crypto.createHmac("sha256", s).update(body).digest("hex");
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.RAZORPAY_KEY_ID = "rzp_test_dummy"; process.env.RAZORPAY_KEY_SECRET = "dummysecret"; process.env.RAZORPAYX_ACCOUNT_NUMBER = "2323230000000000";
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "pout_1", status: "queued" }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); for (const k of ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAYX_ACCOUNT_NUMBER"]) delete process.env[k]; });

describe("verifyRazorpayXWebhook", () => {
  const body = JSON.stringify({ event: "payout.processed" });
  it("accepts a correct signature", () => expect(verifyRazorpayXWebhook(body, sign(body), SECRET)).toBe(true));
  it("rejects a wrong secret, tampered body, empty signature, wrong length, missing secret", () => {
    expect(verifyRazorpayXWebhook(body, sign(body, "other"), SECRET)).toBe(false);
    expect(verifyRazorpayXWebhook(body + " ", sign(body), SECRET)).toBe(false);
    expect(verifyRazorpayXWebhook(body, "", SECRET)).toBe(false);
    expect(verifyRazorpayXWebhook(body, "abc", SECRET)).toBe(false);
    expect(verifyRazorpayXWebhook(body, sign(body), "")).toBe(false);
  });
});

describe("client", () => {
  it("fails closed with a clear message when not configured", () => {
    delete process.env.RAZORPAYX_ACCOUNT_NUMBER;
    expect(() => assertRazorpayxConfigured()).toThrow(/RAZORPAYX_ACCOUNT_NUMBER/);
  });
  it("never calls fetch when unconfigured", async () => {
    delete process.env.RAZORPAYX_ACCOUNT_NUMBER;
    await expect(createPayout({ fundAccountId: "fa_1", amountCents: 50000, kind: "upi", idempotencyKey: "k", referenceId: "k" })).rejects.toThrow(/not configured/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("sends the payout id as the idempotency header, the right mode, queue_if_low_balance false", async () => {
    await createPayout({ fundAccountId: "fa_1", amountCents: 123400, kind: "bank", idempotencyKey: "11111111-1111-1111-1111-111111111111", referenceId: "11111111-1111-1111-1111-111111111111" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe("https://api.razorpay.com/v1/payouts");
    expect(init.headers["X-Payout-Idempotency"]).toBe("11111111-1111-1111-1111-111111111111");
    const b = JSON.parse(init.body as string);
    expect(b).toMatchObject({ amount: 123400, currency: "INR", mode: "IMPS", fund_account_id: "fa_1", queue_if_low_balance: false, account_number: "2323230000000000" });
    expect(payoutModeFor("upi")).toBe("UPI");
  });
  it("rejects non-integer or non-positive amounts before any request", async () => {
    await expect(createPayout({ fundAccountId: "f", amountCents: 10.5, kind: "upi", idempotencyKey: "k", referenceId: "k" })).rejects.toThrow();
    await expect(createPayout({ fundAccountId: "f", amountCents: 0, kind: "upi", idempotencyKey: "k", referenceId: "k" })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("surfaces API errors with the HTTP status and without echoing credentials", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { description: "Insufficient balance" } }), { status: 400 }));
    const err = await createPayout({ fundAccountId: "f", amountCents: 50000, kind: "upi", idempotencyKey: "k", referenceId: "k" }).catch(e => e);
    expect(err).toBeInstanceOf(RazorpayXError);
    expect(err.status).toBe(400); expect(err.message).toBe("Insufficient balance");
    expect(String(err.message)).not.toMatch(/dummysecret|rzp_test/);
  });
  it("builds vpa and bank fund accounts", async () => {
    await createFundAccount("cont_1", { kind: "upi", vpa: "a@okhdfc" });
    await createFundAccount("cont_1", { kind: "bank", name: "A B", ifsc: "SBIN0001234", accountNumber: "123456789012" });
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toMatchObject({ account_type: "vpa", vpa: { address: "a@okhdfc" } });
    expect(JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string)).toMatchObject({ account_type: "bank_account", bank_account: { ifsc: "SBIN0001234" } });
  });
});
