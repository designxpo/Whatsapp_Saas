// Pure fraud-resistance rules for the affiliate program. No I/O: everything
// here is a function of its arguments (plus one env read for the hold period),
// so every rule can be unit tested without a database.

export const DEFAULT_HOLD_DAYS = 10;
const DAY_MS = 24 * 3600 * 1000;

/** Days a commission is held after the customer's payment (refund/chargeback window). AFFILIATE_HOLD_DAYS overrides. */
export function affiliateHoldDays(): number {
  const raw = Number(process.env.AFFILIATE_HOLD_DAYS);
  return Number.isFinite(raw) && raw >= 0 && raw <= 365 ? Math.floor(raw) : DEFAULT_HOLD_DAYS;
}

/** When a commission earned on a payment at `paymentDate` becomes payable. */
export function payableAt(paymentDate: Date | string, holdDays: number = affiliateHoldDays()): Date {
  const t = paymentDate instanceof Date ? paymentDate.getTime() : Date.parse(paymentDate);
  if (!Number.isFinite(t)) throw new Error("payableAt: invalid payment date");
  return new Date(t + holdDays * DAY_MS);
}

// ── self-referral ──────────────────────────────────────────────────────────
export const FREE_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.in", "yahoo.co.in", "ymail.com", "rocketmail.com",
  "outlook.com", "outlook.in", "hotmail.com", "hotmail.co.in", "live.com", "live.in", "msn.com",
  "icloud.com", "me.com", "mac.com", "proton.me", "protonmail.com", "pm.me",
  "rediffmail.com", "rediff.com", "aol.com", "zoho.com", "zohomail.in", "gmx.com", "mail.com", "yandex.com",
]);

export function normalizeEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

export function emailDomain(email: string | null | undefined): string {
  const e = normalizeEmail(email);
  const at = e.lastIndexOf("@");
  return at < 0 ? "" : e.slice(at + 1);
}

/** Last 10 digits of a phone number; null when fewer than 10 digits are present. */
export function normalizePhone(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : null;
}

export interface SelfReferralParty { email?: string | null; phone?: string | null; createdAt?: string | Date | null }
export interface RiskVerdict { flagged: boolean; reasons: string[] }

/**
 * Does this referral look like the affiliate referring themselves? Any one
 * signal flags it; a flagged commission is never auto-paid and needs the
 * owner to clear it.
 *   same email | same phone (last 10 digits) | same NON-free email domain |
 *   the tenant existed before the affiliate enrolled.
 */
export function isSelfReferral(affiliate: SelfReferralParty, tenantOwner: SelfReferralParty): RiskVerdict {
  const reasons: string[] = [];
  const ae = normalizeEmail(affiliate.email), te = normalizeEmail(tenantOwner.email);
  if (ae && te && ae === te) reasons.push("same_email");
  const ap = normalizePhone(affiliate.phone), tp = normalizePhone(tenantOwner.phone);
  if (ap && tp && ap === tp) reasons.push("same_phone");
  const ad = emailDomain(ae), td = emailDomain(te);
  if (ad && td && ad === td && !FREE_EMAIL_DOMAINS.has(ad)) reasons.push("same_email_domain");
  const ac = affiliate.createdAt ? Date.parse(String(affiliate.createdAt instanceof Date ? affiliate.createdAt.toISOString() : affiliate.createdAt)) : NaN;
  const tc = tenantOwner.createdAt ? Date.parse(String(tenantOwner.createdAt instanceof Date ? tenantOwner.createdAt.toISOString() : tenantOwner.createdAt)) : NaN;
  if (Number.isFinite(ac) && Number.isFinite(tc) && tc < ac) reasons.push("tenant_predates_affiliate");
  return { flagged: reasons.length > 0, reasons };
}

// ── velocity ───────────────────────────────────────────────────────────────
export const VELOCITY_LIMIT = 5;
export const VELOCITY_WINDOW_MS = DAY_MS;

/**
 * True when `limit` or more referred conversions fall inside any single
 * rolling `windowMs` window. `conversionTimes` is one timestamp per referred
 * business (its first paid conversion), not per renewal.
 */
export function velocityFlag(conversionTimes: Array<string | Date | number>, limit = VELOCITY_LIMIT, windowMs = VELOCITY_WINDOW_MS): boolean {
  const ts = conversionTimes
    .map(t => (t instanceof Date ? t.getTime() : typeof t === "number" ? t : Date.parse(t)))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  for (let i = 0; i + limit - 1 < ts.length; i++) {
    if (ts[i + limit - 1] - ts[i] < windowMs) return true;
  }
  return false;
}

// ── refunds ────────────────────────────────────────────────────────────────
export interface RefundableCommission {
  status: "pending" | "processing" | "paid" | "void";
  kind?: "earning" | "clawback";
  commissionCents: number;
  payoutId?: string | null;
}
export type RefundDecision =
  | { action: "void" }
  | { action: "clawback"; cents: number }
  | { action: "none" };

/**
 * A refund or lost dispute on the referred customer's payment.
 *   not yet claimed into any payout -> void the commission
 *   already in a payout (processing/paid) -> a clawback row, netted off the next payout
 *   already void / not an earning -> nothing to do
 * `fraction` (0..1] is the refunded share of the payment; 1 = full refund.
 */
export function decideRefund(c: RefundableCommission, fraction = 1): RefundDecision {
  if (c.kind === "clawback" || c.status === "void") return { action: "none" };
  const f = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 1;
  if (f <= 0) return { action: "none" };
  if (c.status === "pending" && !c.payoutId) {
    // A partial refund cannot void part of a row; the caller handles that case
    // (flags the row for the owner) before it gets here with f < 1.
    return { action: "void" };
  }
  const cents = Math.round(c.commissionCents * f);
  return cents > 0 ? { action: "clawback", cents } : { action: "none" };
}

// ── payout-account name matching ───────────────────────────────────────────
function nameTokens(name: string): string[] {
  return name
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(t => t && !["mr", "mrs", "ms", "miss", "dr", "shri", "shree", "smt", "sri"].includes(t));
}

/**
 * Does the name the bank/UPI registered match the affiliate's name? Tolerant of
 * word order, case, punctuation, diacritics, titles, a missing middle name and
 * initials ("R Kumar" ~ "Rahul Kumar"). Not tolerant of a different person:
 * every word of the shorter name must match a word of the longer one, at least
 * two words are required on the shorter side, and at least one match must be a
 * full word rather than an initial.
 */
export function nameMatches(registeredName: string | null | undefined, affiliateName: string | null | undefined): boolean {
  const a = nameTokens(registeredName ?? ""), b = nameTokens(affiliateName ?? "");
  if (!a.length || !b.length) return false;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length < 2) return false;
  const used = new Set<number>();
  let fullMatches = 0;
  for (const t of short) {
    let found = -1;
    // Prefer an exact word match, then fall back to an initial match.
    for (let i = 0; i < long.length; i++) if (!used.has(i) && long[i] === t) { found = i; break; }
    if (found >= 0) { used.add(found); fullMatches++; continue; }
    if (t.length === 1) {
      for (let i = 0; i < long.length; i++) if (!used.has(i) && long[i][0] === t) { found = i; break; }
      if (found >= 0) { used.add(found); continue; }
    } else {
      // A long word vs an initial on the other side.
      for (let i = 0; i < long.length; i++) if (!used.has(i) && long[i].length === 1 && t[0] === long[i]) { found = i; break; }
      if (found >= 0) { used.add(found); continue; }
    }
    return false;
  }
  return fullMatches >= 1;
}
