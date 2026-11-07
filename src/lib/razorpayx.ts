// RazorpayX Payouts: thin fetch client (no SDK, same convention as razorpay.ts).
// Same API key pair as Razorpay Payments, HTTP Basic auth, base
// https://api.razorpay.com/v1. Docs relied on:
//   https://razorpay.com/docs/api/x/contacts/
//   https://razorpay.com/docs/api/x/fund-accounts/
//   https://razorpay.com/docs/api/x/fund-account-validation/
//   https://razorpay.com/docs/api/x/payouts/  (X-Payout-Idempotency header)
//   https://razorpay.com/docs/x/webhooks/     (x-razorpay-signature = HMAC-SHA256 of the raw body)
// Payload shapes here follow those docs and have NOT been exercised against
// the live API. Nothing in this file logs secrets or full account numbers.

import crypto from "crypto";

const BASE = "https://api.razorpay.com/v1";

export class RazorpayXError extends Error {
  constructor(message: string, public status: number) { super(message); this.name = "RazorpayXError"; }
}

export function razorpayxConfigured(): boolean {
  return !!process.env.RAZORPAY_KEY_ID && !!process.env.RAZORPAY_KEY_SECRET && !!process.env.RAZORPAYX_ACCOUNT_NUMBER;
}

/** Fails closed with an actionable message when payouts are not set up. */
export function assertRazorpayxConfigured(): void {
  const missing = ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAYX_ACCOUNT_NUMBER"].filter(k => !process.env[k]);
  if (missing.length) throw new Error(`RazorpayX payouts are not configured (missing ${missing.join(", ")})`);
}

function accountNumber(): string {
  const n = process.env.RAZORPAYX_ACCOUNT_NUMBER;
  if (!n) throw new Error("RazorpayX payouts are not configured (missing RAZORPAYX_ACCOUNT_NUMBER)");
  return n;
}

async function rzpx<T>(path: string, init: RequestInit & { idempotencyKey?: string } = {}): Promise<T> {
  assertRazorpayxConfigured();
  const auth = `Basic ${Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString("base64")}`;
  const { idempotencyKey, ...rest } = init;
  const res = await fetch(`${BASE}${path}`, {
    ...rest,
    headers: {
      "Content-Type": "application/json", Authorization: auth,
      ...(idempotencyKey ? { "X-Payout-Idempotency": idempotencyKey } : {}),
      ...(rest.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (body as { error?: { description?: string } })?.error?.description ?? `RazorpayX API error (HTTP ${res.status})`;
    throw new RazorpayXError(msg, res.status);
  }
  return body as T;
}

export interface RzpxContact { id: string }
export async function createContact(p: { name: string; email?: string | null; phone?: string | null; referenceId: string }): Promise<RzpxContact> {
  const body: Record<string, unknown> = { name: p.name, type: "vendor", reference_id: p.referenceId };
  if (p.email) body.email = p.email;
  if (p.phone) body.contact = p.phone;
  return rzpx<RzpxContact>("/contacts", { method: "POST", body: JSON.stringify(body) });
}

export type FundAccountInput =
  | { kind: "upi"; vpa: string }
  | { kind: "bank"; name: string; ifsc: string; accountNumber: string };

export interface RzpxFundAccount { id: string; account_type: string; active?: boolean }
export async function createFundAccount(contactId: string, dest: FundAccountInput): Promise<RzpxFundAccount> {
  const body = dest.kind === "upi"
    ? { contact_id: contactId, account_type: "vpa", vpa: { address: dest.vpa } }
    : { contact_id: contactId, account_type: "bank_account", bank_account: { name: dest.name, ifsc: dest.ifsc, account_number: dest.accountNumber } };
  return rzpx<RzpxFundAccount>("/fund_accounts", { method: "POST", body: JSON.stringify(body) });
}

export interface RzpxValidation {
  id: string; status: string;   // created | completed | failed
  fund_account?: { id?: string };
  results?: { account_status?: string | null; registered_name?: string | null };
}
/** Penny test: a Rs 1 validation. The registered name comes back on the fund_account.validation.completed webhook (or via polling this id). */
export async function startFundAccountValidation(fundAccountId: string, referenceId: string): Promise<RzpxValidation> {
  return rzpx<RzpxValidation>("/fund_accounts/validations", {
    method: "POST",
    body: JSON.stringify({
      account_number: accountNumber(), fund_account: { id: fundAccountId },
      amount: 100, currency: "INR", reference_id: referenceId.slice(0, 40),
    }),
  });
}
export async function getFundAccountValidation(id: string): Promise<RzpxValidation> {
  return rzpx<RzpxValidation>(`/fund_accounts/validations/${encodeURIComponent(id)}`);
}

export interface RzpxPayout {
  id: string; status: string; utr?: string | null; reference_id?: string | null;
  fund_account_id?: string; amount?: number; failure_reason?: string | null;
  status_details?: { description?: string | null } | null;
}
export function payoutModeFor(kind: "upi" | "bank"): "UPI" | "IMPS" { return kind === "upi" ? "UPI" : "IMPS"; }

/**
 * Create a payout. `idempotencyKey` (our payout id) is sent as
 * X-Payout-Idempotency so a retried call after a network error cannot pay twice.
 * queue_if_low_balance is false: an under-funded account fails the payout
 * instead of paying at some later, unattended time.
 */
export async function createPayout(p: {
  fundAccountId: string; amountCents: number; kind: "upi" | "bank"; idempotencyKey: string; referenceId: string; narration?: string;
}): Promise<RzpxPayout> {
  if (!Number.isInteger(p.amountCents) || p.amountCents <= 0) throw new Error("Invalid payout amount");
  return rzpx<RzpxPayout>("/payouts", {
    method: "POST", idempotencyKey: p.idempotencyKey,
    body: JSON.stringify({
      account_number: accountNumber(), fund_account_id: p.fundAccountId,
      amount: p.amountCents, currency: "INR", mode: payoutModeFor(p.kind), purpose: "payout",
      queue_if_low_balance: false, reference_id: p.referenceId.slice(0, 40),
      narration: (p.narration ?? "Talko affiliate payout").slice(0, 30),
    }),
  });
}
export async function getPayout(id: string): Promise<RzpxPayout> {
  return rzpx<RzpxPayout>(`/payouts/${encodeURIComponent(id)}`);
}

/** HMAC-SHA256 hex of the raw body, compared in constant time. Same scheme as verifyRazorpayWebhook. */
export function verifyRazorpayXWebhook(rawBody: string, signature: string, secret: string): boolean {
  if (!secret || !signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const sigBuf = Buffer.from(signature), expBuf = Buffer.from(expected);
  return sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf);
}
