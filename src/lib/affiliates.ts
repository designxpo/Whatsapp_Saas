// Affiliate/referral program. Anyone can enroll (no Talko tenant required),
// gets a unique referral code, and earns a flat % recurring commission on
// every subscription payment made by a tenant they referred — for as long as
// that tenant stays subscribed. See supabase/migrations/0107_affiliates.sql.

import { randomBytes } from "crypto";
import { db } from "./supabase";
import { hashPassword, verifyPassword } from "./team";
import { ownerAudit } from "./tenants";
import { sendEmail } from "./email";
import { isReservedEmail, RESERVED_EMAIL_MESSAGE } from "./reserved-email";
import { isSelfReferral, velocityFlag, VELOCITY_WINDOW_MS, payableAt, affiliateHoldDays } from "./affiliate-risk";

export interface Affiliate {
  id: string; email: string; name: string; phone: string | null;
  code: string; commissionPct: number; status: "active" | "suspended";
  payoutMethod: string | null; createdAt: string;
}

function mapAffiliate(r: Record<string, unknown>): Affiliate {
  return {
    id: r.id as string, email: r.email as string, name: r.name as string,
    phone: (r.phone as string | null) ?? null, code: r.code as string,
    commissionPct: Number(r.commission_pct ?? 10),
    status: (r.status as Affiliate["status"]) ?? "active",
    payoutMethod: (r.payout_method as string | null) ?? null,
    createdAt: r.created_at as string,
  };
}

// Short, URL-safe, human-shareable codes (e.g. "PRIYESH4F2A") — a slugified
// name prefix plus a few random base36 chars for uniqueness, not a raw UUID.
function generateCode(name: string): string {
  const prefix = name.toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 8) || "PARTNER";
  const suffix = randomBytes(3).toString("hex").toUpperCase();
  return `${prefix}${suffix}`;
}

export async function enrollAffiliate(p: { email: string; name: string; password: string; phone?: string }): Promise<Affiliate> {
  const email = p.email.trim().toLowerCase();
  if (isReservedEmail(email)) throw new Error(RESERVED_EMAIL_MESSAGE);
  const existing = await db().from("wa_affiliates").select("id").eq("email", email).maybeSingle();
  if (existing.data) throw new Error("An affiliate account with this email already exists — try logging in.");

  let code = generateCode(p.name);
  for (let i = 0; i < 5; i++) {
    const clash = await db().from("wa_affiliates").select("id").eq("code", code).maybeSingle();
    if (!clash.data) break;
    code = generateCode(p.name);
  }

  const { data, error } = await db().from("wa_affiliates").insert({
    email, name: p.name.trim(), phone: p.phone?.trim() || null,
    password_hash: hashPassword(p.password), code,
  }).select("*").single();
  if (error) throw error;
  return mapAffiliate(data as Record<string, unknown>);
}

// A well-formed scrypt hash that no password matches. Checked against when the
// email is unknown, so an unknown address costs the same scrypt run as a known
// one with a wrong password — the response time can't be used to find out
// which addresses are affiliates.
const DUMMY_PASSWORD_HASH = `${"0".repeat(32)}:${"0".repeat(128)}`;

export async function verifyAffiliateLogin(email: string, password: string): Promise<Affiliate | null> {
  const { data } = await db().from("wa_affiliates").select("*").eq("email", email.trim().toLowerCase()).maybeSingle();
  const stored = typeof data?.password_hash === "string" && data.password_hash ? data.password_hash : DUMMY_PASSWORD_HASH;
  const ok = verifyPassword(password, stored);
  if (!data || !ok) return null;
  return mapAffiliate(data as Record<string, unknown>);
}

export async function getAffiliate(id: string): Promise<Affiliate | null> {
  const { data } = await db().from("wa_affiliates").select("*").eq("id", id).maybeSingle();
  return data ? mapAffiliate(data as Record<string, unknown>) : null;
}

// Active-only lookup by referral code — used at signup time. An unknown or
// suspended code resolves to null and never blocks signup.
export async function getActiveAffiliateByCode(code: string): Promise<Affiliate | null> {
  const { data } = await db().from("wa_affiliates").select("*").eq("code", code.trim().toUpperCase()).eq("status", "active").maybeSingle();
  return data ? mapAffiliate(data as Record<string, unknown>) : null;
}

// Owner-portal edit — commission rate and/or status. A rate change only
// affects commission recorded AFTER this point: every existing ledger row
// already has its own commission_pct stamped at the time it was earned, so
// past commission never silently changes when the rate does.
export async function updateAffiliate(id: string, p: { commissionPct?: number; status?: Affiliate["status"] }): Promise<Affiliate> {
  const row: Record<string, unknown> = {};
  if (p.commissionPct !== undefined) {
    if (!Number.isFinite(p.commissionPct) || p.commissionPct < 0 || p.commissionPct > 100) throw new Error("Commission rate must be between 0 and 100");
    row.commission_pct = p.commissionPct;
  }
  if (p.status !== undefined) row.status = p.status;
  if (!Object.keys(row).length) throw new Error("Nothing to update");
  const { data, error } = await db().from("wa_affiliates").update(row).eq("id", id).select("*").single();
  if (error) throw error;
  return mapAffiliate(data as Record<string, unknown>);
}

export interface ReferredTenant { tenantId: string; company: string | null; plan: string; paymentStatus: string; createdAt: string }

export async function listReferredTenants(affiliateId: string): Promise<ReferredTenant[]> {
  const { data } = await db().from("tenants")
    .select("id, company, plan, payment_status, created_at")
    .eq("referred_by_affiliate_id", affiliateId)
    .order("created_at", { ascending: false });
  return (data ?? []).map(r => ({
    tenantId: r.id as string, company: (r.company as string | null) ?? null,
    plan: r.plan as string, paymentStatus: r.payment_status as string, createdAt: r.created_at as string,
  }));
}

export interface CommissionRow {
  id: string; tenantId: string; company: string | null; plan: string;
  amountCents: number; commissionPct: number; commissionCents: number;
  status: "pending" | "processing" | "paid" | "void"; paidAt: string | null; createdAt: string;
}

export async function listCommissions(affiliateId: string): Promise<CommissionRow[]> {
  const { data } = await db().from("wa_affiliate_commissions")
    .select("id, tenant_id, plan, amount_cents, commission_pct, commission_cents, status, paid_at, created_at, tenants(company)")
    .eq("affiliate_id", affiliateId)
    .order("created_at", { ascending: false });
  return (data ?? []).map(r => ({
    id: r.id as string, tenantId: r.tenant_id as string,
    company: ((r.tenants as { company?: string | null } | null)?.company) ?? null,
    plan: r.plan as string, amountCents: r.amount_cents as number,
    commissionPct: Number(r.commission_pct), commissionCents: r.commission_cents as number,
    status: r.status as CommissionRow["status"], paidAt: (r.paid_at as string | null) ?? null,
    createdAt: r.created_at as string,
  }));
}

export interface AffiliateStats {
  affiliateId: string; name: string; email: string; code: string; commissionPct: number;
  referredCount: number; convertedCount: number; pendingCents: number; paidCents: number; lifetimeCents: number;
}

function mapStatsRow(r: Record<string, unknown>): AffiliateStats {
  return {
    affiliateId: r.affiliate_id as string, name: r.name as string, email: r.email as string,
    code: r.code as string, commissionPct: Number(r.commission_pct),
    referredCount: Number(r.referred_count), convertedCount: Number(r.converted_count),
    pendingCents: Number(r.pending_cents), paidCents: Number(r.paid_cents), lifetimeCents: Number(r.lifetime_cents),
  };
}

// Owner-portal summary across every affiliate — one SQL round-trip via the
// owner_affiliate_stats() aggregate (0107_affiliates.sql), not a JS loop.
export async function ownerAffiliateStats(): Promise<AffiliateStats[]> {
  const { data, error } = await db().rpc("owner_affiliate_stats");
  if (error) throw error;
  return (data ?? []).map(mapStatsRow);
}

// One affiliate's own numbers, computed directly rather than via the
// all-affiliates aggregate — cheap and correct regardless of fleet size.
export async function affiliateOwnStats(affiliateId: string): Promise<AffiliateStats | null> {
  const affiliate = await getAffiliate(affiliateId);
  if (!affiliate) return null;
  const [referred, commissions] = await Promise.all([listReferredTenants(affiliateId), listCommissions(affiliateId)]);
  const pendingCents = commissions.filter(c => c.status === "pending" || c.status === "processing").reduce((s, c) => s + c.commissionCents, 0);
  const paidCents = commissions.filter(c => c.status === "paid").reduce((s, c) => s + c.commissionCents, 0);
  return {
    affiliateId: affiliate.id, name: affiliate.name, email: affiliate.email,
    code: affiliate.code, commissionPct: affiliate.commissionPct,
    referredCount: referred.length, convertedCount: referred.filter(t => t.paymentStatus === "active").length,
    pendingCents, paidCents, lifetimeCents: pendingCents + paidCents,
  };
}

function subjectForCommission(): string {
  return "You earned a commission — Talko AI";
}
function htmlForCommission(amountRupees: string, company: string, holdDays: number): string {
  return `<div style="font-family:sans-serif;font-size:15px;color:#111">
    <p>Good news — <strong>${company}</strong> just made a subscription payment, and you earned <strong>₹${amountRupees}</strong> in commission.</p>
    <p style="color:#666">It's recorded as pending in your affiliate dashboard and becomes payable ${holdDays} days after the customer's payment, once the refund window has passed. Payouts are reviewed and sent to your verified payout account.</p>
  </div>`;
}

// Called after applySubscription() records an active payment. No-ops
// immediately for the overwhelming majority of tenants (no referring
// affiliate). Idempotent twice over: the unique index on provider_payment_id
// (one earning per gateway payment, however many times it is reported) and the
// old (affiliate, tenant, subscription, period) key for Stripe.
//
// Fraud screening happens here: a self-referral or a burst of conversions sets
// flagged + flag_reason, and a flagged row is never auto-paid (the owner clears
// it). Every commission becomes payable only after the refund-window hold.
export async function recordAffiliateCommission(tenantId: string, p: {
  amountCents: number; plan?: string; subscriptionId?: string | null; currentPeriodEnd?: string | null;
  providerPaymentId?: string | null;
}): Promise<void> {
  if (!Number.isFinite(p.amountCents) || p.amountCents <= 0) return;
  const { data: tenant } = await db().from("tenants").select("referred_by_affiliate_id, company, owner_email, owner_phone, created_at").eq("id", tenantId).maybeSingle();
  const affiliateId = tenant?.referred_by_affiliate_id as string | null | undefined;
  if (!affiliateId) return;

  const { data: arow } = await db().from("wa_affiliates").select("id, email, name, phone, status, commission_pct, created_at").eq("id", affiliateId).maybeSingle();
  if (!arow || arow.status !== "active") return;
  const commissionPct = Number(arow.commission_pct ?? 10);

  const commissionCents = Math.round((p.amountCents * commissionPct) / 100);
  if (commissionCents <= 0) return;

  const paymentId = p.providerPaymentId?.trim() || null;
  if (paymentId) {
    const dup = await db().from("wa_affiliate_commissions").select("id").eq("provider_payment_id", paymentId).eq("kind", "earning").maybeSingle();
    if (dup.data) return;
  }

  const now = new Date();
  const reasons = [...isSelfReferral(
    { email: arow.email as string, phone: arow.phone as string | null, createdAt: arow.created_at as string },
    { email: tenant?.owner_email as string | null, phone: tenant?.owner_phone as string | null, createdAt: tenant?.created_at as string },
  ).reasons];
  try {
    // One timestamp per referred business: its first earning in the last 24h.
    const since = new Date(now.getTime() - VELOCITY_WINDOW_MS).toISOString();
    const recent = await db().from("wa_affiliate_commissions").select("tenant_id, created_at")
      .eq("affiliate_id", affiliateId).eq("kind", "earning").gte("created_at", since).order("created_at", { ascending: true });
    const firstByTenant = new Map<string, string>();
    for (const r of (recent.data ?? []) as { tenant_id: string; created_at: string }[]) if (!firstByTenant.has(r.tenant_id)) firstByTenant.set(r.tenant_id, r.created_at);
    if (!firstByTenant.has(tenantId)) firstByTenant.set(tenantId, now.toISOString());
    if (velocityFlag([...firstByTenant.values()])) reasons.push("conversion_velocity");
  } catch { /* velocity is a screening aid; never block recording a commission on it */ }

  // Idempotency key for the legacy path: period_start must identify the
  // BILLING CYCLE, not "when we happened to process this" (Stripe redelivers
  // webhooks; currentPeriodEnd is fixed for a cycle).
  const { error } = await db().from("wa_affiliate_commissions").insert({
    affiliate_id: affiliateId, tenant_id: tenantId,
    stripe_subscription_id: p.subscriptionId ?? null,
    period_start: p.currentPeriodEnd ?? null, period_end: p.currentPeriodEnd ?? null,
    plan: p.plan ?? "unknown", amount_cents: p.amountCents,
    commission_pct: commissionPct, commission_cents: commissionCents,
    provider_payment_id: paymentId, payable_at: payableAt(now).toISOString(),
    flagged: reasons.length > 0, flag_reason: reasons.length ? reasons.join(",") : null,
  });
  // 23505 = unique_violation: this payment/cycle was already recorded.
  if (error && (error as { code?: string }).code !== "23505") throw error;
  if (error) return;

  if (reasons.length) await ownerAudit("system", "affiliate.commission_flagged", tenantId, `Commission held for review (${reasons.join(", ")}) for affiliate ${affiliateId}`);

  try {
    await sendEmail({
      to: arow.email as string,
      subject: subjectForCommission(),
      html: htmlForCommission((commissionCents / 100).toFixed(2), (tenant?.company as string) || "A referred business", affiliateHoldDays()),
      type: "affiliate_commission",   // recipient is the affiliate, not the referred tenant — tenantId left unset
    });
  } catch { /* commission is recorded regardless of email delivery */ }
}

// EMERGENCY manual path (the owner paid off-platform). Without manualOverride
// it only accepts plain, payable, unflagged earnings that are in no payout:
// anything flagged, still inside the hold, already in a payout, a clawback, or
// not pending is refused. With manualOverride it accepts flagged and in-hold
// earnings too (still never rows inside a payout, which only the payout flow
// settles), and the override and its reason are written to the audit log.
export async function markCommissionsPaid(affiliateId: string, commissionIds: string[], actorEmail: string, opts: { manualOverride?: boolean; reason?: string } = {}): Promise<void> {
  if (!commissionIds.length) return;
  const override = opts.manualOverride === true;
  if (override && !opts.reason?.trim()) throw new Error("A reason is required for a manual override");
  const { data: rows, error: readErr } = await db().from("wa_affiliate_commissions")
    .select("id, status, kind, flagged, flag_reason, payout_id, payable_at, commission_cents")
    .eq("affiliate_id", affiliateId).in("id", commissionIds);
  if (readErr) throw readErr;
  const found = (rows ?? []) as { id: string; status: string; kind: string; flagged: boolean; flag_reason: string | null; payout_id: string | null; payable_at: string | null; commission_cents: number }[];
  if (found.length !== new Set(commissionIds).size) throw new Error("Some commissions were not found for this affiliate");
  const nowMs = Date.now();
  const problems: string[] = [];
  let overridden = 0;
  for (const r of found) {
    if (r.status !== "pending" || r.payout_id || r.kind !== "earning") { problems.push(`${r.id}: not a pending, unpaid earning`); continue; }
    const needsOverride = r.flagged || (r.payable_at !== null && Date.parse(r.payable_at) > nowMs);
    if (needsOverride) { if (!override) problems.push(`${r.id}: ${r.flagged ? "flagged for review" : "still inside the refund-window hold"}`); else overridden++; }
  }
  if (problems.length) throw new Error(`Refused: ${problems.join("; ")}`);
  const { data: upd, error } = await db().from("wa_affiliate_commissions")
    .update({ status: "paid", paid_at: new Date().toISOString() })
    .eq("affiliate_id", affiliateId).in("id", commissionIds).eq("status", "pending").is("payout_id", null).select("id");
  if (error) throw error;
  if ((upd ?? []).length !== found.length) throw new Error("Some commissions changed while being marked paid; reload and retry");
  await ownerAudit(actorEmail, override ? "affiliate.payout_manual_override" : "affiliate.payout",
    null, `Marked ${commissionIds.length} commission(s) paid for affiliate ${affiliateId}${override ? ` MANUAL OVERRIDE (${overridden} flagged/held): ${opts.reason!.trim().slice(0, 300)}` : ""}`);
}
