// Automated affiliate payouts via RazorpayX. Money leaves the company through
// this file, so the rules are:
//   * rows enter a payout ONLY through the claim_affiliate_payout() SQL function
//     (row-locked, one transaction), so a commission cannot be paid twice;
//   * every payout needs explicit owner approval (AFFILIATE_AUTO_APPROVE_MAX_CENTS
//     is 0 by default = never auto-approve) and every limit is re-checked at
//     approval time, against the affiliate's CURRENT state;
//   * the payout id is the RazorpayX idempotency key, so a retried call cannot
//     send the money twice;
//   * webhooks are idempotent: a redelivered payout.processed changes nothing.
//
// MANUAL MODE (no RazorpayX yet). payoutMode() is "manual" until RazorpayX is
// configured (or when AFFILIATE_PAYOUT_MODE=manual). Every check above still
// runs; only the last step differs. Approval moves the payout to "processing"
// without calling any API. The owner then opens the payment details (the one
// place the encrypted destination is decrypted, owner-only and audited), pays
// from their own bank/UPI app, and records the UTR / UPI reference, which marks
// the payout paid through the same idempotent SQL function the webhook uses.
// A payout account saved in manual mode gets a synthetic "manual_<uuid>" fund
// id, minted fresh on every change, so "the account changed after this request"
// is still detected, and such an id is never sent to RazorpayX. Verification is
// the owner's: send Rs 1, check the name the bank/UPI app shows, then verify.
// Amounts are paise (the codebase calls them "cents").

import { db } from "./supabase";
import { ownerAudit } from "./tenants";
import { sendEmail } from "./email";
import { encryptSecret, decryptSecret } from "./crypto";
import { randomUUID } from "crypto";
import { isIfsc, normalizeIfsc } from "./ifsc";
import { getAffiliate } from "./affiliates";
import { affiliateHoldDays, decideRefund, nameMatches } from "./affiliate-risk";
import * as rzpx from "./razorpayx";

// ── limits (paise). Each can be overridden by an env var; read at call time ──
export const DEFAULT_MIN_PAYOUT_CENTS = 50_000;              // Rs 500 minimum payout
export const DEFAULT_MAX_PAYOUT_CENTS = 2_500_000;           // Rs 25,000 per payout
export const DEFAULT_AFFILIATE_30D_CAP_CENTS = 5_000_000;    // Rs 50,000 per affiliate, rolling 30 days
export const DEFAULT_GLOBAL_DAILY_CAP_CENTS = 10_000_000;    // Rs 1,00,000 across all affiliates, rolling 24h
export const PAYOUT_ACCOUNT_COOLDOWN_DAYS = 7;               // no payout for 7 days after the destination changes

function envInt(name: string, def: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return def;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : def;
}
/** Env overrides: AFFILIATE_MIN_PAYOUT_CENTS, AFFILIATE_MAX_PAYOUT_CENTS, AFFILIATE_30D_CAP_CENTS, AFFILIATE_DAILY_CAP_CENTS, AFFILIATE_AUTO_APPROVE_MAX_CENTS. */
export function payoutLimits() {
  return {
    minCents: envInt("AFFILIATE_MIN_PAYOUT_CENTS", DEFAULT_MIN_PAYOUT_CENTS),
    maxCents: envInt("AFFILIATE_MAX_PAYOUT_CENTS", DEFAULT_MAX_PAYOUT_CENTS),
    affiliate30dCents: envInt("AFFILIATE_30D_CAP_CENTS", DEFAULT_AFFILIATE_30D_CAP_CENTS),
    globalDailyCents: envInt("AFFILIATE_DAILY_CAP_CENTS", DEFAULT_GLOBAL_DAILY_CAP_CENTS),
    autoApproveMaxCents: envInt("AFFILIATE_AUTO_APPROVE_MAX_CENTS", 0),   // 0 = never auto-approve
  };
}

/** A refusal with a message safe to show the owner. */
export type PayoutMode = "razorpayx" | "manual";
/** "razorpayx" once it is configured, else "manual". AFFILIATE_PAYOUT_MODE=manual|razorpayx forces one. */
export function payoutMode(): PayoutMode {
  const m = process.env.AFFILIATE_PAYOUT_MODE?.trim().toLowerCase();
  if (m === "manual" || m === "razorpayx") return m;
  return rzpx.razorpayxConfigured() ? "razorpayx" : "manual";
}
export const MANUAL_FUND_PREFIX = "manual_";
export const isManualFundId = (id: unknown): boolean => typeof id === "string" && id.startsWith(MANUAL_FUND_PREFIX);

export class PayoutError extends Error {
  constructor(message: string) { super(message); this.name = "PayoutError"; }
}

/** The RazorpayX idempotency key for a payout: its own id, stable across retries. */
export function idempotencyKeyFor(payoutId: string): string { return payoutId; }

// ── destination validation (strict, server-side) ───────────────────────────
const VPA_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,63}@[a-zA-Z][a-zA-Z0-9]{2,29}$/;
export function validateVpa(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  return VPA_RE.test(v) ? v.toLowerCase() : null;
}
export function validateAccountNumber(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.replace(/\s/g, "");
  if (!/^\d{9,18}$/.test(v)) return null;
  if (/^(\d)\1+$/.test(v)) return null;   // 000000000, 111111111...
  return v;
}
export function validateIfscCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = normalizeIfsc(raw);
  return isIfsc(v) ? v : null;
}

// ── eligibility (pure) ─────────────────────────────────────────────────────
export interface PayoutAccountState {
  status: string; riskHold: boolean; payoutKind: string | null; fundAccountId: string | null;
  verifiedAt: string | null; changedAt: string | null;
}
/** Why this affiliate cannot be paid right now; empty = eligible. */
export function payoutBlockers(a: PayoutAccountState, now: Date = new Date()): string[] {
  const out: string[] = [];
  if (a.status !== "active") out.push("affiliate_not_active");
  if (a.riskHold) out.push("risk_hold");
  if (!a.payoutKind || !a.fundAccountId || !a.changedAt) out.push("no_payout_account");
  else if (!a.verifiedAt || Date.parse(a.verifiedAt) < Date.parse(a.changedAt)) out.push("payout_account_unverified");
  if (a.changedAt && Date.parse(a.changedAt) > now.getTime() - PAYOUT_ACCOUNT_COOLDOWN_DAYS * 24 * 3600 * 1000) out.push("payout_account_changed_recently");
  return out;
}

// ── row mapping (explicit column lists: payout_details_enc is never selected) ─
const ACCOUNT_COLS = "id, email, name, phone, status, payout_kind, payout_name, payout_last4, payout_verified_at, payout_changed_at, rzpx_contact_id, rzpx_fund_account_id, risk_hold, risk_note";
type Row = Record<string, unknown>;

function accountState(r: Row): PayoutAccountState {
  return {
    status: String(r.status ?? ""), riskHold: r.risk_hold === true, payoutKind: (r.payout_kind as string | null) ?? null,
    fundAccountId: (r.rzpx_fund_account_id as string | null) ?? null,
    verifiedAt: (r.payout_verified_at as string | null) ?? null, changedAt: (r.payout_changed_at as string | null) ?? null,
  };
}

export interface PayoutAccountStatus {
  configured: boolean; kind: "upi" | "bank" | null; last4: string | null; name: string | null;
  verified: boolean; changedAt: string | null; cooldownEndsAt: string | null;
  status: "none" | "pending_verification" | "verified";
}
/** What the AFFILIATE may see of their own payout account: masked and non-sensitive only. */
export async function getPayoutAccountStatus(affiliateId: string): Promise<PayoutAccountStatus> {
  const { data } = await db().from("wa_affiliates").select(ACCOUNT_COLS).eq("id", affiliateId).maybeSingle();
  const r = (data ?? {}) as Row;
  const st = accountState(r);
  const configured = !!st.payoutKind && !!st.fundAccountId;
  const verified = configured && !!st.verifiedAt && !!st.changedAt && Date.parse(st.verifiedAt) >= Date.parse(st.changedAt);
  const cooldownEnd = st.changedAt ? Date.parse(st.changedAt) + PAYOUT_ACCOUNT_COOLDOWN_DAYS * 24 * 3600 * 1000 : null;
  return {
    configured, kind: (st.payoutKind as "upi" | "bank" | null) ?? null, last4: (r.payout_last4 as string | null) ?? null,
    name: (r.payout_name as string | null) ?? null, verified, changedAt: st.changedAt,
    cooldownEndsAt: cooldownEnd && cooldownEnd > Date.now() ? new Date(cooldownEnd).toISOString() : null,
    status: !configured ? "none" : verified ? "verified" : "pending_verification",
  };
}

function maskDestination(kind: "upi" | "bank", last4: string): string {
  return kind === "upi" ? `UPI ending ${last4}` : `bank account ending ${last4}`;
}

// ── affiliate: set / change payout destination ─────────────────────────────
export type PayoutDetailsInput =
  | { kind: "upi"; vpa: unknown }
  | { kind: "bank"; accountNumber: unknown; ifsc: unknown };

/**
 * Store a new payout destination. The caller (route) has ALREADY proven the
 * session and re-verified the password. Order matters: validate, check
 * RazorpayX is configured, create the contact + fund account at RazorpayX
 * (nothing local changes if that fails), then write the encrypted details with
 * payout_changed_at = now (starts the 7-day cooldown) and verified cleared,
 * then start the penny test and send the security email.
 */
export async function setPayoutDetails(affiliateId: string, input: PayoutDetailsInput): Promise<PayoutAccountStatus> {
  const aff = await getAffiliate(affiliateId);
  if (!aff) throw new PayoutError("Affiliate account not found");
  if (aff.status !== "active") throw new PayoutError("This affiliate account is not active");

  let dest: rzpx.FundAccountInput, secretJson: string, last4: string;
  if (input.kind === "upi") {
    const vpa = validateVpa(input.vpa);
    if (!vpa) throw new PayoutError("Enter a valid UPI ID, like name@bank");
    dest = { kind: "upi", vpa }; secretJson = JSON.stringify({ kind: "upi", vpa }); last4 = vpa.split("@")[0].slice(-4);
  } else if (input.kind === "bank") {
    const accountNumber = validateAccountNumber(input.accountNumber);
    const ifsc = validateIfscCode(input.ifsc);
    if (!accountNumber) throw new PayoutError("Enter a valid bank account number (9 to 18 digits)");
    if (!ifsc) throw new PayoutError("Enter a valid IFSC code, like SBIN0001234");
    dest = { kind: "bank", name: aff.name, ifsc, accountNumber }; secretJson = JSON.stringify({ kind: "bank", accountNumber, ifsc }); last4 = accountNumber.slice(-4);
  } else throw new PayoutError("Choose UPI or bank account");

  const manual = payoutMode() === "manual";
  const { data: cur } = await db().from("wa_affiliates").select("rzpx_contact_id").eq("id", affiliateId).maybeSingle();
  let contactId = (cur?.rzpx_contact_id as string | null) ?? null;
  let fundId: string;
  if (manual) {
    fundId = `${MANUAL_FUND_PREFIX}${randomUUID()}`;   // fresh on every change: a later approval can tell the account moved
  } else {
    rzpx.assertRazorpayxConfigured();
    if (!contactId) contactId = (await rzpx.createContact({ name: aff.name, email: aff.email, phone: aff.phone, referenceId: aff.id })).id;
    fundId = (await rzpx.createFundAccount(contactId, dest)).id;
  }

  const nowIso = new Date().toISOString();
  const { error } = await db().from("wa_affiliates").update({
    payout_kind: input.kind, payout_details_enc: encryptSecret(secretJson), payout_name: aff.name, payout_last4: last4,
    payout_verified_at: null, payout_changed_at: nowIso, rzpx_contact_id: contactId, rzpx_fund_account_id: fundId, risk_note: null,
  }).eq("id", affiliateId);
  if (error) throw error;

  let validationNote: string | null = null;
  if (manual) validationNote = "Manual verification needed: send Rs 1 to this account and confirm the name your bank/UPI app shows matches the affiliate.";
  else {
    try { await rzpx.startFundAccountValidation(fundId, `val_${aff.id.slice(0, 30)}`); }
    catch (err) { validationNote = `Penny-test could not be started: ${err instanceof Error ? err.message : "unknown error"}`.slice(0, 300); }
  }
  if (validationNote) await db().from("wa_affiliates").update({ risk_note: validationNote }).eq("id", affiliateId);

  await ownerAudit("system", "affiliate.payout_account_changed", null, `Affiliate ${affiliateId} set a ${input.kind} payout account ending ${last4}`);
  try {
    await sendEmail({
      to: aff.email, subject: "Your Talko affiliate payout account was changed", type: "other",
      html: `<div style="font-family:sans-serif;font-size:15px;color:#111">
        <p>The payout account on your Talko affiliate profile was just changed to <strong>${maskDestination(input.kind, last4)}</strong>.</p>
        <p>For your security, no payout is sent for ${PAYOUT_ACCOUNT_COOLDOWN_DAYS} days after a change, and the account must be verified first.</p>
        <p style="color:#b00020"><strong>If you did not do this, reply to this email immediately and change your password.</strong></p></div>`,
    });
  } catch { /* the change is recorded regardless of email delivery */ }
  return getPayoutAccountStatus(affiliateId);
}

// ── fund account validation webhook ────────────────────────────────────────
interface ValidationEntity { id?: string; status?: string; fund_account?: { id?: string }; results?: { account_status?: string | null; registered_name?: string | null } }

export async function handleFundAccountValidationWebhook(event: { event: string; payload?: Record<string, { entity?: ValidationEntity } | undefined> }): Promise<{ handled: boolean; outcome?: string }> {
  const ent = (event.payload?.["fund_account.validation"] ?? (event.payload as { fund_account?: { validation?: { entity?: ValidationEntity } } } | undefined)?.fund_account?.validation)?.entity as ValidationEntity | undefined;
  const fundId = ent?.fund_account?.id;
  if (!ent || !fundId) return { handled: false };
  const { data } = await db().from("wa_affiliates").select(ACCOUNT_COLS).eq("rzpx_fund_account_id", fundId).maybeSingle();
  if (!data) return { handled: false, outcome: "unknown_fund_account" };   // stale validation of a replaced account
  const aff = data as Row;
  const id = aff.id as string;

  if (event.event === "fund_account.validation.failed" || ent.status === "failed") {
    await db().from("wa_affiliates").update({ risk_note: "Penny-test failed: the payout account could not be validated" }).eq("id", id);
    await ownerAudit("razorpayx-webhook", "affiliate.payout_account_validation_failed", null, `Affiliate ${id}`);
    return { handled: true, outcome: "failed" };
  }
  if (event.event !== "fund_account.validation.completed") return { handled: false };

  const registered = ent.results?.registered_name ?? null;
  const active = (ent.results?.account_status ?? "").toLowerCase() === "active";
  if (active && registered && nameMatches(registered, aff.name as string)) {
    await db().from("wa_affiliates").update({ payout_verified_at: new Date().toISOString(), risk_note: null }).eq("id", id);
    await ownerAudit("razorpayx-webhook", "affiliate.payout_account_verified", null, `Affiliate ${id}: registered name matched`);
    return { handled: true, outcome: "verified" };
  }
  const note = !active ? "Payout account is not active at the bank/UPI provider"
    : !registered ? "Penny-test returned no registered name; verify manually"
      : `Name mismatch: account registered to "${registered}", affiliate is "${aff.name}"`;
  await db().from("wa_affiliates").update({ risk_note: note.slice(0, 300) }).eq("id", id);
  await ownerAudit("razorpayx-webhook", "affiliate.payout_account_name_mismatch", null, `Affiliate ${id}: ${note}`.slice(0, 400));
  return { handled: true, outcome: "needs_review" };
}

// ── claim / approve / reject ───────────────────────────────────────────────
/** Ask the database to bundle this affiliate's payable commissions into one awaiting-approval payout. Null = nothing payable / not eligible. */
export async function createPayoutRequest(affiliateId: string, actor = "system"): Promise<string | null> {
  const L = payoutLimits();
  const { data, error } = await db().rpc("claim_affiliate_payout", {
    p_affiliate: affiliateId, p_min_cents: L.minCents, p_max_cents: L.maxCents, p_hold: `${affiliateHoldDays()} days`,
  });
  if (error) throw error;
  const payoutId = (data as string | null) ?? null;
  if (!payoutId) return null;
  const { data: p } = await db().from("wa_affiliate_payouts").select("amount_cents").eq("id", payoutId).maybeSingle();
  const amount = Number(p?.amount_cents ?? 0);
  await ownerAudit(actor, "affiliate.payout_requested", null, `Payout ${payoutId} of ${amount} paise requested for affiliate ${affiliateId}`);

  // Optional auto-approval: off by default; never for an affiliate's first payout.
  if (L.autoApproveMaxCents > 0 && amount > 0 && amount <= L.autoApproveMaxCents) {
    const prior = await db().from("wa_affiliate_payouts").select("id").eq("affiliate_id", affiliateId).eq("status", "paid").limit(1);
    if ((prior.data ?? []).length) {
      try { await approvePayout(payoutId, "auto-approve"); }
      catch (err) { console.error(JSON.stringify({ at: "affiliatePayouts.autoApprove", payoutId, error: err instanceof Error ? err.message : String(err) })); }
    }
  }
  return payoutId;
}

async function sumPayouts(since: Date, affiliateId?: string): Promise<number> {
  let q = db().from("wa_affiliate_payouts").select("amount_cents").in("status", ["approved", "processing", "paid"]).gte("approved_at", since.toISOString());
  if (affiliateId) q = q.eq("affiliate_id", affiliateId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).reduce((s, r) => s + Number((r as Row).amount_cents ?? 0), 0);
}

async function release(payoutId: string, status: "failed" | "cancelled" | "reversed", reason: string, from?: string[]): Promise<boolean> {
  const args: Record<string, unknown> = { p_payout: payoutId, p_status: status, p_reason: reason };
  if (from) args.p_from = from;
  const { data, error } = await db().rpc("release_affiliate_payout", args);
  if (error) throw error;
  return data === true;
}

/**
 * Owner approves a payout and the money is sent. Everything is re-checked NOW,
 * against current state, not what was true when the request was created.
 * Concurrency: the awaiting_approval -> approved transition is a conditional
 * update, and the cap checks run after it and count this payout, so two
 * simultaneous approvals can only over-refuse, never over-pay.
 */
export async function approvePayout(payoutId: string, ownerEmail: string): Promise<{ status: string; rzpPayoutId: string | null; manual: boolean }> {
  const L = payoutLimits();
  const { data: cur } = await db().from("wa_affiliate_payouts").select("*").eq("id", payoutId).maybeSingle();
  if (!cur) throw new PayoutError("Payout not found");
  // A manual fund id can only ever be paid by hand; anything else is paid by hand
  // only while RazorpayX is not in use.
  const manual = isManualFundId((cur.payout_snapshot as { fund_account_id?: unknown } | null)?.fund_account_id) || payoutMode() === "manual";
  if (!manual) rzpx.assertRazorpayxConfigured();
  const resume = cur.status === "approved" && !cur.rzp_payout_id;   // an earlier send had an unknown outcome; the idempotency key makes a re-send safe
  if (!resume) {
    if (cur.status !== "awaiting_approval") throw new PayoutError(`Payout is already ${String(cur.status).replace("_", " ")}`);
    const { data: moved } = await db().from("wa_affiliate_payouts")
      .update({ status: "approved", approved_by: ownerEmail, approved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", payoutId).eq("status", "awaiting_approval").select("id");
    if (!(moved ?? []).length) throw new PayoutError("Payout was changed by someone else; reload");
  }
  const amount = Number(cur.amount_cents);
  const snapshot = (cur.payout_snapshot ?? {}) as { kind?: "upi" | "bank"; fund_account_id?: string };

  const stop = async (reason: string, opts: { cancel?: boolean } = {}): Promise<never> => {
    if (!resume) {
      if (opts.cancel) await release(payoutId, "cancelled", reason, ["approved"]);
      else await db().from("wa_affiliate_payouts").update({ status: "awaiting_approval", approved_by: null, approved_at: null, updated_at: new Date().toISOString() }).eq("id", payoutId).eq("status", "approved").is("rzp_payout_id", null);
    }
    await ownerAudit(ownerEmail, "affiliate.payout_approval_refused", null, `Payout ${payoutId}: ${reason}`);
    throw new PayoutError(reason);
  };

  const { data: affRow } = await db().from("wa_affiliates").select(ACCOUNT_COLS).eq("id", cur.affiliate_id).maybeSingle();
  if (!affRow) return stop("Affiliate not found");
  const blockers = payoutBlockers(accountState(affRow as Row));
  if (blockers.length) return stop(`Affiliate cannot be paid now: ${blockers.join(", ")}`);
  if (!snapshot.fund_account_id || snapshot.fund_account_id !== (affRow as Row).rzpx_fund_account_id) return stop("The payout account changed after this request was created");
  if (!snapshot.kind || (snapshot.kind !== "upi" && snapshot.kind !== "bank")) return stop("Payout destination type is missing");
  if (amount < L.minCents) return stop("Below the minimum payout");
  if (amount > L.maxCents) return stop("Above the per-payout cap");

  const { data: rows } = await db().from("wa_affiliate_commissions").select("id, commission_cents, flagged, kind").eq("payout_id", payoutId);
  const items = (rows ?? []) as { id: string; commission_cents: number; flagged: boolean; kind: string }[];
  if (items.reduce((s, r) => s + Number(r.commission_cents), 0) !== amount) return stop("Payout total does not match its commissions", { cancel: true });
  if (items.some(r => r.flagged)) return stop("A commission in this payout was flagged after the request; it was cancelled and the commissions released", { cancel: true });
  const earningIds = items.filter(r => r.kind === "earning").map(r => r.id);
  if (earningIds.length) {
    const { data: claw } = await db().from("wa_affiliate_commissions").select("id").eq("affiliate_id", cur.affiliate_id).eq("kind", "clawback").eq("status", "pending").is("payout_id", null).in("ref_commission_id", earningIds);
    if ((claw ?? []).length) return stop("A refund arrived for a commission in this payout; it was cancelled so the next request nets it", { cancel: true });
  }

  const now = Date.now();
  if (await sumPayouts(new Date(now - 30 * 24 * 3600 * 1000), cur.affiliate_id as string) > L.affiliate30dCents) return stop("Affiliate 30-day payout cap would be exceeded");
  if (await sumPayouts(new Date(now - 24 * 3600 * 1000)) > L.globalDailyCents) return stop("Global daily payout cap would be exceeded");

  if (manual) {
    const { data: moved } = await db().from("wa_affiliate_payouts")
      .update({ status: "processing", payout_snapshot: { ...(cur.payout_snapshot as Row), mode: "manual" }, updated_at: new Date().toISOString() })
      .eq("id", payoutId).eq("status", "approved").is("rzp_payout_id", null).select("id");
    if (!(moved ?? []).length) throw new PayoutError("Payout was changed by someone else; reload");
    await ownerAudit(ownerEmail, "affiliate.payout_approved_manual", null, `Payout ${payoutId} of ${amount} paise approved for manual payment`);
    return { status: "processing", rzpPayoutId: null, manual: true };
  }

  let rp: rzpx.RzpxPayout;
  try {
    rp = await rzpx.createPayout({
      fundAccountId: snapshot.fund_account_id, amountCents: amount, kind: snapshot.kind,
      idempotencyKey: idempotencyKeyFor(payoutId), referenceId: payoutId,
    });
  } catch (err) {
    const status = err instanceof rzpx.RazorpayXError ? err.status : 0;
    const msg = err instanceof Error ? err.message : "RazorpayX error";
    const definite = status >= 400 && status < 500 && ![408, 409, 429].includes(status);
    if (definite) {
      await release(payoutId, "failed", `RazorpayX refused: ${msg}`.slice(0, 300));
      await ownerAudit(ownerEmail, "affiliate.payout_failed", null, `Payout ${payoutId} refused by RazorpayX (HTTP ${status})`);
      throw new PayoutError(`RazorpayX refused the payout: ${msg}`);
    }
    // Unknown outcome (network / 5xx / rate limit): leave it approved. Approving again re-sends with the same idempotency key.
    await ownerAudit(ownerEmail, "affiliate.payout_send_unknown", null, `Payout ${payoutId}: send outcome unknown, safe to retry`);
    throw new PayoutError("Could not confirm the send with RazorpayX. Approve again to retry; the same idempotency key prevents a double payment.");
  }

  await db().from("wa_affiliate_payouts").update({ status: "processing", rzp_payout_id: rp.id, updated_at: new Date().toISOString() }).eq("id", payoutId).in("status", ["approved", "processing"]);
  await ownerAudit(ownerEmail, "affiliate.payout_approved", null, `Payout ${payoutId} of ${amount} paise approved and sent (${rp.id})`);
  await applyPayoutOutcome(payoutId, rp.status, { utr: rp.utr ?? null, reason: rp.failure_reason ?? rp.status_details?.description ?? null }, "razorpayx");
  return { status: "processing", rzpPayoutId: rp.id, manual: false };
}

// ── manual payments ────────────────────────────────────────────────────────
function isManualPayout(r: Row): boolean {
  return (r.payout_snapshot as { mode?: string } | null)?.mode === "manual" && !r.rzp_payout_id;
}

/** UPI / IMPS / NEFT references: 10-22 letters or digits (UPI and IMPS are 12 digits). */
export function validateUtr(raw: unknown): string | null {
  const s = typeof raw === "string" ? raw.trim().toUpperCase().replace(/\s+/g, "") : "";
  return /^[A-Z0-9]{10,22}$/.test(s) ? s : null;
}

export function upiPayLink(p: { vpa: string; name: string; amountCents: number; payoutId?: string; note?: string }): string {
  const tn = p.note ?? `Talko affiliate payout ${(p.payoutId ?? "").slice(0, 8)}`;
  const q = new URLSearchParams({ pa: p.vpa, pn: p.name, am: (p.amountCents / 100).toFixed(2), cu: "INR", tn });
  return `upi://pay?${q.toString().replace(/\+/g, "%20")}`;
}

export interface ManualPaymentInstructions {
  payoutId: string; amountCents: number; kind: "upi" | "bank"; name: string;
  vpa: string | null; accountNumber: string | null; ifsc: string | null; upiLink: string | null;
}

/**
 * Owner-only: the full destination for a payout approved in manual mode. The
 * ONLY place payout_details_enc is decrypted. Refuses unless the payout is a
 * manual one awaiting payment and the affiliate's account is still exactly the
 * one the request was made for. Every view is audited.
 */
export async function getManualPaymentInstructions(payoutId: string, ownerEmail: string): Promise<ManualPaymentInstructions> {
  const { data: p } = await db().from("wa_affiliate_payouts").select("id, affiliate_id, amount_cents, status, rzp_payout_id, payout_snapshot").eq("id", payoutId).maybeSingle();
  if (!p) throw new PayoutError("Payout not found");
  if (p.status !== "processing" || !isManualPayout(p as Row)) throw new PayoutError("Only an approved manual payout can be paid by hand");
  const snap = (p.payout_snapshot ?? {}) as { fund_account_id?: string; kind?: "upi" | "bank" };
  const { data: a } = await db().from("wa_affiliates").select("name, status, risk_hold, payout_kind, rzpx_fund_account_id, payout_details_enc").eq("id", p.affiliate_id).maybeSingle();
  if (!a) throw new PayoutError("Affiliate not found");
  if (a.status !== "active" || a.risk_hold === true) throw new PayoutError("This affiliate is no longer payable; cancel this payout");
  if (!snap.fund_account_id || a.rzpx_fund_account_id !== snap.fund_account_id) throw new PayoutError("The payout account changed after approval; cancel this payout and request a new one");
  let d: { kind?: string; vpa?: string; accountNumber?: string; ifsc?: string };
  try { d = JSON.parse(decryptSecret(String(a.payout_details_enc ?? ""))); } catch { throw new PayoutError("Payout details could not be read"); }
  const kind = d.kind === "upi" ? "upi" : d.kind === "bank" ? "bank" : null;
  if (!kind || kind !== snap.kind) throw new PayoutError("Payout details do not match this payout");
  const name = String(a.name ?? "");
  const amountCents = Number(p.amount_cents);
  await ownerAudit(ownerEmail, "affiliate.payout_details_viewed", null, `Payout ${payoutId}: owner opened the ${kind} details to pay by hand`);
  return {
    payoutId, amountCents, kind, name,
    vpa: kind === "upi" ? d.vpa ?? null : null,
    accountNumber: kind === "bank" ? d.accountNumber ?? null : null,
    ifsc: kind === "bank" ? d.ifsc ?? null : null,
    upiLink: kind === "upi" && d.vpa ? upiPayLink({ vpa: d.vpa, name, amountCents, payoutId }) : null,
  };
}

export const VERIFICATION_AMOUNT_CENTS = 100;   // Rs 1 test transfer
export interface VerificationDetails {
  affiliateId: string; kind: "upi" | "bank"; name: string; amountCents: number;
  vpa: string | null; accountNumber: string | null; ifsc: string | null; upiLink: string | null;
}

/**
 * Owner-only, manual verification: the full destination of an UNVERIFIED payout
 * account, so the owner can send Rs 1 and check the name their bank/UPI app
 * shows before clicking Verify. Refused once the account is verified (this is
 * not a way to browse stored details), for a suspended affiliate, or without an
 * account. Every view is audited.
 */
export async function getVerificationDetails(affiliateId: string, ownerEmail: string): Promise<VerificationDetails> {
  const { data: a } = await db().from("wa_affiliates").select("name, status, payout_kind, rzpx_fund_account_id, payout_verified_at, payout_changed_at, payout_details_enc").eq("id", affiliateId).maybeSingle();
  if (!a) throw new PayoutError("Affiliate not found");
  if (a.status !== "active") throw new PayoutError("This affiliate account is not active");
  if (!a.payout_kind || !a.rzpx_fund_account_id || !a.payout_changed_at) throw new PayoutError("This affiliate has no payout account");
  const verified = !!a.payout_verified_at && Date.parse(String(a.payout_verified_at)) >= Date.parse(String(a.payout_changed_at));
  if (verified) throw new PayoutError("This payout account is already verified");
  let d: { kind?: string; vpa?: string; accountNumber?: string; ifsc?: string };
  try { d = JSON.parse(decryptSecret(String(a.payout_details_enc ?? ""))); } catch { throw new PayoutError("Payout details could not be read"); }
  const kind = d.kind === "upi" ? "upi" : d.kind === "bank" ? "bank" : null;
  if (!kind || kind !== a.payout_kind) throw new PayoutError("Payout details do not match this account");
  const name = String(a.name ?? "");
  await ownerAudit(ownerEmail, "affiliate.payout_details_viewed_for_verification", null, `Affiliate ${affiliateId}: owner opened the ${kind} details to send the Rs 1 check`);
  return {
    affiliateId, kind, name, amountCents: VERIFICATION_AMOUNT_CENTS,
    vpa: kind === "upi" ? d.vpa ?? null : null,
    accountNumber: kind === "bank" ? d.accountNumber ?? null : null,
    ifsc: kind === "bank" ? d.ifsc ?? null : null,
    upiLink: kind === "upi" && d.vpa ? upiPayLink({ vpa: d.vpa, name, amountCents: VERIFICATION_AMOUNT_CENTS, note: "Talko affiliate account check" }) : null,
  };
}

/** Owner paid by hand: record the bank/UPI reference. Idempotent; a reference can be used for one payout only. */
export async function recordManualPayment(payoutId: string, utrRaw: unknown, ownerEmail: string): Promise<void> {
  const utr = validateUtr(utrRaw);
  if (!utr) throw new PayoutError("Enter the UTR / UPI reference number from your bank app (10 to 22 letters or digits)");
  const { data: p } = await db().from("wa_affiliate_payouts").select("id, status, rzp_payout_id, payout_snapshot").eq("id", payoutId).maybeSingle();
  if (!p) throw new PayoutError("Payout not found");
  if (p.status === "paid") throw new PayoutError("This payout is already recorded as paid");
  if (p.status !== "processing" || !isManualPayout(p as Row)) throw new PayoutError("Only an approved manual payout can be recorded as paid");
  const { data: dup } = await db().from("wa_affiliate_payouts").select("id").eq("utr", utr).limit(1);
  if ((dup ?? []).length) throw new PayoutError("That reference number is already recorded on another payout");
  const { data, error } = await db().rpc("mark_affiliate_payout_paid", { p_payout: payoutId, p_utr: utr });
  if (error) {
    if ((error as { code?: string }).code === "23505") throw new PayoutError("That reference number is already recorded on another payout");
    throw error;
  }
  if (data !== true) throw new PayoutError("This payout could not be marked paid; reload");
  await ownerAudit(ownerEmail, "affiliate.payout_paid_manual", null, `Payout ${payoutId} paid by hand (ref ${utr})`);
  await notifyPaid(payoutId);
}

/**
 * Owner approved a manual payout but did NOT send the money (or the transfer
 * failed): release its commissions so they can be paid later. The confirmation
 * phrase guards against cancelling something that was in fact paid, which would
 * let the same commissions be paid twice.
 */
export const MANUAL_CANCEL_CONFIRMATION = "NOT PAID";
export async function cancelManualPayout(payoutId: string, ownerEmail: string, reason: string, confirmation: unknown): Promise<void> {
  if (confirmation !== MANUAL_CANCEL_CONFIRMATION) throw new PayoutError(`Type ${MANUAL_CANCEL_CONFIRMATION} to confirm no money was sent`);
  if (!reason.trim()) throw new PayoutError("A reason is required");
  const { data: p } = await db().from("wa_affiliate_payouts").select("id, status, rzp_payout_id, payout_snapshot").eq("id", payoutId).maybeSingle();
  if (!p) throw new PayoutError("Payout not found");
  if (!isManualPayout(p as Row)) throw new PayoutError("Only a manual payout can be cancelled here");
  if (!(await release(payoutId, "cancelled", reason.trim().slice(0, 300), ["processing"]))) throw new PayoutError("Only an unpaid manual payout can be cancelled");
  await ownerAudit(ownerEmail, "affiliate.payout_cancelled_manual", null, `Payout ${payoutId} cancelled before payment: ${reason.trim().slice(0, 200)}`);
}

export async function rejectPayout(payoutId: string, ownerEmail: string, reason = "Rejected by owner"): Promise<void> {
  // Only a payout still awaiting approval can be rejected; one that was sent (or whose send is unconfirmed) cannot be unwound here.
  const ok = await release(payoutId, "cancelled", reason.slice(0, 300), ["awaiting_approval"]);
  if (!ok) throw new PayoutError("Only a payout awaiting approval can be rejected");
  await ownerAudit(ownerEmail, "affiliate.payout_rejected", null, `Payout ${payoutId} rejected; commissions released`);
}

// ── RazorpayX payout webhook ───────────────────────────────────────────────
/**
 * Apply a payout outcome. Idempotent: the SQL functions only transition once,
 * so a redelivered event returns false and sends no second email.
 */
export async function applyPayoutOutcome(payoutId: string, rzpStatus: string, d: { utr?: string | null; reason?: string | null }, actor: string): Promise<string> {
  const reason = (d.reason ?? rzpStatus).toString().slice(0, 300);
  if (rzpStatus === "processed") {
    const { data, error } = await db().rpc("mark_affiliate_payout_paid", { p_payout: payoutId, p_utr: d.utr ?? null });
    if (error) throw error;
    if (data !== true) return "no_change";   // replay, or not in a payable state
    await ownerAudit(actor, "affiliate.payout_paid", null, `Payout ${payoutId} paid${d.utr ? ` (UTR ${d.utr})` : ""}`);
    await notifyPaid(payoutId);
    return "paid";
  }
  if (rzpStatus === "failed" || rzpStatus === "rejected" || rzpStatus === "cancelled") {
    if (!(await release(payoutId, "failed", reason))) return "ignored";
    await ownerAudit(actor, "affiliate.payout_failed", null, `Payout ${payoutId} ${rzpStatus}: ${reason}`);
    return "released";
  }
  if (rzpStatus === "reversed") {
    if (!(await release(payoutId, "reversed", reason))) return "ignored";
    const { data: p } = await db().from("wa_affiliate_payouts").select("affiliate_id").eq("id", payoutId).maybeSingle();
    if (p?.affiliate_id) await db().from("wa_affiliates").update({ risk_hold: true, risk_note: "A payout was reversed by the bank; review before paying again" }).eq("id", p.affiliate_id);
    await ownerAudit(actor, "affiliate.payout_reversed", null, `Payout ${payoutId} reversed; affiliate put on risk hold`);
    return "reversed";
  }
  return "ignored";   // queued / pending / initiated: nothing to settle yet
}

async function notifyPaid(payoutId: string): Promise<void> {
  try {
    const { data: p } = await db().from("wa_affiliate_payouts").select("amount_cents, affiliate_id, payout_snapshot").eq("id", payoutId).maybeSingle();
    if (!p) return;
    const { data: a } = await db().from("wa_affiliates").select("email, name").eq("id", p.affiliate_id).maybeSingle();
    if (!a?.email) return;
    const snap = (p.payout_snapshot ?? {}) as { kind?: "upi" | "bank"; last4?: string };
    const dest = snap.kind && snap.last4 ? maskDestination(snap.kind, snap.last4) : "your payout account";
    await sendEmail({
      to: a.email as string, subject: "Your Talko affiliate payout was sent", type: "affiliate_commission",
      html: `<div style="font-family:sans-serif;font-size:15px;color:#111"><p>Your payout of <strong>₹${(Number(p.amount_cents) / 100).toFixed(2)}</strong> was sent to ${dest}.</p></div>`,
    });
  } catch { /* the payout is settled regardless of email delivery */ }
}

interface PayoutWebhookBody { event: string; payload?: { payout?: { entity?: rzpx.RzpxPayout } } }

export async function handlePayoutWebhook(event: PayoutWebhookBody): Promise<{ handled: boolean; outcome?: string }> {
  const ent = event.payload?.payout?.entity;
  if (!ent?.id) return { handled: false };
  let { data: p } = await db().from("wa_affiliate_payouts").select("id, rzp_payout_id, status").eq("rzp_payout_id", ent.id).maybeSingle();
  if (!p && ent.reference_id && /^[0-9a-f-]{36}$/i.test(ent.reference_id)) {
    // The event can outrun our own write of rzp_payout_id; reference_id is our payout id.
    ({ data: p } = await db().from("wa_affiliate_payouts").select("id, rzp_payout_id, status").eq("id", ent.reference_id).maybeSingle());
    if (p && !p.rzp_payout_id) await db().from("wa_affiliate_payouts").update({ rzp_payout_id: ent.id }).eq("id", p.id).is("rzp_payout_id", null);
  }
  if (!p) return { handled: false, outcome: "unknown_payout" };
  const status = event.event.startsWith("payout.") ? event.event.slice("payout.".length) : ent.status;
  const outcome = await applyPayoutOutcome(p.id as string, status, { utr: ent.utr ?? null, reason: ent.failure_reason ?? ent.status_details?.description ?? null }, "razorpayx-webhook");
  return { handled: true, outcome };
}

// ── refunds / disputes on the referred customer's payment ──────────────────
export type ReversalEvent = "refund" | "dispute_created" | "dispute_won" | "dispute_lost";

export async function applyPaymentReversal(p: { paymentId: string; event: ReversalEvent; refundAmount?: number | null; paymentAmount?: number | null }): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data } = await db().from("wa_affiliate_commissions")
      .select("id, affiliate_id, tenant_id, plan, amount_cents, commission_pct, commission_cents, status, flagged, flag_reason, payout_id, kind")
      .eq("provider_payment_id", p.paymentId).eq("kind", "earning").maybeSingle();
    if (!data) return "no_commission";
    const c = data as Row;
    const id = c.id as string, status = c.status as string, inPayout = !!c.payout_id;
    if (status === "void") return "already_void";

    if (p.event === "dispute_created") {
      if (status === "pending" || status === "processing") {
        const reason = c.flag_reason && c.flag_reason !== "dispute_open" ? `${c.flag_reason},dispute_open` : "dispute_open";
        await db().from("wa_affiliate_commissions").update({ flagged: true, flag_reason: reason }).eq("id", id);
        await ownerAudit("razorpay-webhook", "affiliate.commission_flagged", c.tenant_id as string, `Dispute opened on payment; commission ${id} held`);
      }
      return "flagged";
    }
    if (p.event === "dispute_won") {
      if (c.flag_reason === "dispute_open") await db().from("wa_affiliate_commissions").update({ flagged: false, flag_reason: null }).eq("id", id);
      else if (typeof c.flag_reason === "string" && c.flag_reason.endsWith(",dispute_open")) await db().from("wa_affiliate_commissions").update({ flag_reason: (c.flag_reason as string).replace(/,dispute_open$/, "") }).eq("id", id);
      return "dispute_cleared";
    }

    // refund or lost dispute
    const fraction = p.event === "dispute_lost" ? 1
      : p.refundAmount && p.paymentAmount ? Math.min(1, p.refundAmount / p.paymentAmount) : null;
    if (status === "pending" && !inPayout && (fraction === null || fraction < 1)) {
      // A partial (or unmeasurable) refund cannot void part of a row: hold it for the owner.
      await db().from("wa_affiliate_commissions").update({ flagged: true, flag_reason: fraction === null ? "refund_review" : "partial_refund" }).eq("id", id);
      await ownerAudit("razorpay-webhook", "affiliate.commission_flagged", c.tenant_id as string, `Partial refund on payment; commission ${id} held for review`);
      return "flagged";
    }
    const decision = decideRefund({ status: status as "pending", kind: "earning", commissionCents: Number(c.commission_cents), payoutId: (c.payout_id as string | null) ?? null }, fraction ?? 1);
    if (decision.action === "none") return "none";
    if (decision.action === "void") {
      const { data: upd } = await db().from("wa_affiliate_commissions").update({ status: "void", flagged: false, flag_reason: "refunded" })
        .eq("id", id).eq("status", "pending").is("payout_id", null).select("id");
      if ((upd ?? []).length) {
        await ownerAudit("razorpay-webhook", "affiliate.commission_voided", c.tenant_id as string, `Commission ${id} voided: customer payment refunded before payout`);
        return "voided";
      }
      continue;   // it was claimed into a payout in between: decide again, now as a clawback
    }
    const { error } = await db().from("wa_affiliate_commissions").insert({
      affiliate_id: c.affiliate_id, tenant_id: c.tenant_id, plan: c.plan, kind: "clawback", ref_commission_id: id,
      amount_cents: -Math.round(Number(c.amount_cents) * (fraction ?? 1)), commission_pct: c.commission_pct, commission_cents: -decision.cents, status: "pending",
    });
    if (error && (error as { code?: string }).code !== "23505") throw error;
    if (!error) await ownerAudit("razorpay-webhook", "affiliate.clawback_created", c.tenant_id as string, `Clawback of ${decision.cents} paise recorded against commission ${id}`);
    return "clawback";
  }
  return "retry_exhausted";
}

// ── owner controls ─────────────────────────────────────────────────────────
export async function ownerClearFlag(commissionId: string, actor: string, note: string): Promise<void> {
  if (!note.trim()) throw new PayoutError("A note is required to clear a flag");
  const { data } = await db().from("wa_affiliate_commissions").select("id, flagged, flag_reason, status").eq("id", commissionId).maybeSingle();
  if (!data || !data.flagged) throw new PayoutError("That commission is not flagged");
  if (data.status !== "pending" && data.status !== "processing") throw new PayoutError("Only an unpaid commission can be cleared");
  const { error } = await db().from("wa_affiliate_commissions").update({ flagged: false, flag_reason: null }).eq("id", commissionId);
  if (error) throw error;
  await ownerAudit(actor, "affiliate.flag_cleared", null, `Commission ${commissionId} cleared (was: ${String(data.flag_reason ?? "").slice(0, 100)}): ${note.trim().slice(0, 200)}`);
}

export async function ownerSetRiskHold(affiliateId: string, hold: boolean, actor: string, note?: string): Promise<void> {
  const { data, error } = await db().from("wa_affiliates").update({ risk_hold: hold, ...(hold ? { risk_note: (note ?? "Held by owner").slice(0, 300) } : {}) }).eq("id", affiliateId).select("id");
  if (error) throw error;
  if (!(data ?? []).length) throw new PayoutError("Affiliate not found");
  await ownerAudit(actor, hold ? "affiliate.risk_hold_set" : "affiliate.risk_hold_cleared", null, `Affiliate ${affiliateId}${note ? `: ${note.slice(0, 200)}` : ""}`);
}

/** Owner vouches for the payout account (e.g. after a name mismatch they judged fine). The 7-day cooldown still applies. */
export async function ownerVerifyPayoutAccount(affiliateId: string, actor: string, note: string): Promise<void> {
  if (!note.trim()) throw new PayoutError("A note is required to verify a payout account manually");
  const { data } = await db().from("wa_affiliates").select("rzpx_fund_account_id, payout_kind").eq("id", affiliateId).maybeSingle();
  if (!data?.rzpx_fund_account_id || !data.payout_kind) throw new PayoutError("This affiliate has no payout account");
  const { error } = await db().from("wa_affiliates").update({ payout_verified_at: new Date().toISOString(), risk_note: null }).eq("id", affiliateId);
  if (error) throw error;
  await ownerAudit(actor, "affiliate.payout_account_verified_manual", null, `Affiliate ${affiliateId}: ${note.trim().slice(0, 200)}`);
}

// ── owner dashboard data ───────────────────────────────────────────────────
export interface OwnerAffiliatePayable {
  affiliateId: string; name: string; email: string; status: string; riskHold: boolean; riskNote: string | null;
  payoutKind: string | null; payoutLast4: string | null; payoutName: string | null; verified: boolean; changedAt: string | null;
  blockers: string[]; payableCents: number; holdingCents: number; flaggedCents: number; clawbackCents: number;
}
export interface OwnerPayoutRow {
  id: string; affiliateId: string; affiliateName: string | null; affiliateEmail: string | null; amountCents: number; status: string;
  approvedBy: string | null; approvedAt: string | null; failureReason: string | null; utr: string | null;
  destination: { kind: string | null; last4: string | null; name: string | null }; createdAt: string;
  manual: boolean;   // approved in manual mode: pay by hand, then record the reference
  payByHand: boolean;   // approving this will NOT call RazorpayX (manual mode, or a manual-only account)
}
export interface OwnerFlaggedCommission { id: string; affiliateId: string; tenantId: string; commissionCents: number; flagReason: string | null; createdAt: string }

export async function listOwnerPayoutData(): Promise<{
  payouts: OwnerPayoutRow[]; affiliates: OwnerAffiliatePayable[]; flagged: OwnerFlaggedCommission[];
  limits: ReturnType<typeof payoutLimits> & { holdDays: number }; configured: boolean; mode: PayoutMode;
}> {
  const [pay, aff, com] = await Promise.all([
    db().from("wa_affiliate_payouts").select("id, affiliate_id, amount_cents, status, approved_by, approved_at, failure_reason, utr, rzp_payout_id, payout_snapshot, created_at").order("created_at", { ascending: false }).limit(100),
    db().from("wa_affiliates").select(ACCOUNT_COLS),
    db().from("wa_affiliate_commissions").select("id, affiliate_id, tenant_id, commission_cents, kind, flagged, flag_reason, payable_at, created_at").eq("status", "pending").is("payout_id", null).limit(5000),
  ]);
  const affiliates = new Map<string, Row>(((aff.data ?? []) as Row[]).map(r => [r.id as string, r]));
  const now = Date.now();
  const per = new Map<string, { payable: number; holding: number; flagged: number; claw: number }>();
  const flagged: OwnerFlaggedCommission[] = [];
  for (const c of (com.data ?? []) as Row[]) {
    const id = c.affiliate_id as string, cents = Number(c.commission_cents);
    const s = per.get(id) ?? { payable: 0, holding: 0, flagged: 0, claw: 0 };
    if (c.kind === "clawback") s.claw += cents;
    else if (c.flagged) { s.flagged += cents; flagged.push({ id: c.id as string, affiliateId: id, tenantId: c.tenant_id as string, commissionCents: cents, flagReason: (c.flag_reason as string | null) ?? null, createdAt: c.created_at as string }); }
    else if (c.payable_at && Date.parse(c.payable_at as string) > now) s.holding += cents;
    else s.payable += cents;
    per.set(id, s);
  }
  const rows: OwnerAffiliatePayable[] = [];
  for (const [id, a] of affiliates) {
    const s = per.get(id);
    const st = accountState(a);
    if (!s && !st.payoutKind) continue;   // nothing owed and no payout account: not interesting
    rows.push({
      affiliateId: id, name: a.name as string, email: a.email as string, status: a.status as string, riskHold: a.risk_hold === true,
      riskNote: (a.risk_note as string | null) ?? null, payoutKind: st.payoutKind, payoutLast4: (a.payout_last4 as string | null) ?? null,
      payoutName: (a.payout_name as string | null) ?? null, verified: !!st.verifiedAt && !!st.changedAt && Date.parse(st.verifiedAt) >= Date.parse(st.changedAt),
      changedAt: st.changedAt, blockers: payoutBlockers(st),
      payableCents: s?.payable ?? 0, holdingCents: s?.holding ?? 0, flaggedCents: s?.flagged ?? 0, clawbackCents: s?.claw ?? 0,
    });
  }
  const mode = payoutMode();
  const payouts: OwnerPayoutRow[] = ((pay.data ?? []) as Row[]).map(r => {
    const a = affiliates.get(r.affiliate_id as string);
    const snap = (r.payout_snapshot ?? {}) as { kind?: string; last4?: string; name?: string };
    return {
      id: r.id as string, affiliateId: r.affiliate_id as string, affiliateName: (a?.name as string | undefined) ?? null, affiliateEmail: (a?.email as string | undefined) ?? null,
      amountCents: Number(r.amount_cents), status: r.status as string, approvedBy: (r.approved_by as string | null) ?? null, approvedAt: (r.approved_at as string | null) ?? null,
      failureReason: (r.failure_reason as string | null) ?? null, utr: (r.utr as string | null) ?? null,
      destination: { kind: snap.kind ?? null, last4: snap.last4 ?? null, name: snap.name ?? null }, createdAt: r.created_at as string,
      manual: isManualPayout(r),
      payByHand: isManualPayout(r) || isManualFundId((r.payout_snapshot as { fund_account_id?: unknown } | null)?.fund_account_id) || mode === "manual",
    };
  });
  return { payouts, affiliates: rows, flagged, limits: { ...payoutLimits(), holdDays: affiliateHoldDays() }, configured: rzpx.razorpayxConfigured(), mode };
}
