// Shapes and helpers for the owner payouts screen. The types mirror what
// listOwnerPayoutData() and getManualPaymentInstructions() in
// src/lib/affiliate-payouts.ts return; they are restated here so this client
// bundle never imports the server library.

export type PayoutMode = "razorpayx" | "manual";

export interface Limits {
  minCents: number; maxCents: number; affiliate30dCents: number; globalDailyCents: number;
  autoApproveMaxCents: number; holdDays: number;
}

export interface Payable {
  affiliateId: string; name: string; email: string; status: string; riskHold: boolean; riskNote: string | null;
  payoutKind: string | null; payoutLast4: string | null; payoutName: string | null; verified: boolean; changedAt: string | null;
  blockers: string[]; payableCents: number; holdingCents: number; flaggedCents: number; clawbackCents: number;
}

export interface PayoutRow {
  id: string; affiliateId: string; affiliateName: string | null; affiliateEmail: string | null; amountCents: number; status: string;
  approvedBy: string | null; approvedAt: string | null; failureReason: string | null; utr: string | null;
  destination: { kind: string | null; last4: string | null; name: string | null }; createdAt: string;
  manual: boolean;
  payByHand: boolean;   // approving sends no money through RazorpayX (manual mode or a manual-only account)
}

export interface FlaggedCommission { id: string; affiliateId: string; tenantId: string; commissionCents: number; flagReason: string | null; createdAt: string }

export interface PayoutData {
  payouts: PayoutRow[]; affiliates: Payable[]; flagged: FlaggedCommission[];
  limits: Limits; configured: boolean; mode: PayoutMode;
}

/** Decrypted destination for one manual payout. Lives only inside the pay dialog. */
export interface ManualInstructions {
  payoutId: string; amountCents: number; kind: "upi" | "bank"; name: string;
  vpa: string | null; accountNumber: string | null; ifsc: string | null; upiLink: string | null;
}

/** Decrypted destination of an UNVERIFIED account, for the Rs 1 check. Lives only inside the verify prompt. */
export interface VerificationDetails {
  affiliateId: string; kind: "upi" | "bank"; name: string; amountCents: number;
  vpa: string | null; accountNumber: string | null; ifsc: string | null; upiLink: string | null;
}

export const PAYOUT_ACCOUNT_COOLDOWN_DAYS = 7;   // mirrors the library constant

/** POST to an owner payout action. Resolves the JSON body; rejects with the API's own error text. */
export async function postAction<T = Record<string, unknown>>(action: string, body: Record<string, unknown>): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`/api/owner/affiliate-payouts/${action}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store",
    });
  } catch {
    throw new Error("Couldn't reach the server.");
  }
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok || typeof j.error === "string") throw new Error(typeof j.error === "string" ? j.error : `Request failed (HTTP ${r.status})`);
  return j as T;
}

/** Exact rupees, paise shown only when there are any: ₹1,234 or ₹1,234.50. */
export function rupees(cents: number): string {
  const v = cents / 100;
  const frac = Math.round(Math.abs(cents)) % 100 !== 0;
  return `${v < 0 ? "−" : ""}₹${Math.abs(v).toLocaleString("en-IN", { minimumFractionDigits: frac ? 2 : 0, maximumFractionDigits: 2 })}`;
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function destinationText(kind: string | null, last4: string | null, name: string | null): string {
  if (!kind) return "No payout account";
  const what = kind === "upi" ? "UPI ID" : kind === "bank" ? "Bank account" : kind;
  return `${what} ending ${last4 ?? "----"}${name ? ` · ${name}` : ""}`;
}

export const BLOCKER_TEXT: Record<string, string> = {
  affiliate_not_active: "The affiliate account is not active",
  risk_hold: "On hold",
  no_payout_account: "No payout account added yet",
  payout_account_unverified: "Payout account not verified yet",
  payout_account_changed_recently: `Payout account changed in the last ${PAYOUT_ACCOUNT_COOLDOWN_DAYS} days`,
};

export const FLAG_TEXT: Record<string, string> = {
  same_email: "Same email as the customer",
  same_phone: "Same phone number as the customer",
  same_email_domain: "Same company email domain as the customer",
  tenant_predates_affiliate: "The customer signed up before the affiliate joined",
  conversion_velocity: "Unusually many paid sign-ups within 24 hours",
  dispute_open: "The customer opened a payment dispute",
  refund_review: "A refund on this payment needs review",
  partial_refund: "The payment was partly refunded",
};

export function flagWords(reason: string | null): string[] {
  if (!reason) return ["Held for review"];
  return reason.split(",").map(s => s.trim()).filter(Boolean).map(s => FLAG_TEXT[s] ?? s.replace(/_/g, " "));
}
