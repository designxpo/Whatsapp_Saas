// Affiliate/referral program. Anyone can enroll (no Talko tenant required),
// gets a unique referral code, and earns a flat % recurring commission on
// every subscription payment made by a tenant they referred — for as long as
// that tenant stays subscribed. See supabase/migrations/0107_affiliates.sql.

import { randomBytes } from "crypto";
import { db } from "./supabase";
import { hashPassword, verifyPassword } from "./team";
import { ownerAudit } from "./tenants";
import { sendEmail } from "./email";

export interface Affiliate {
  id: string; email: string; name: string; phone: string | null;
  code: string; commissionPct: number; status: "active" | "suspended";
  payoutMethod: string | null; createdAt: string;
}

function mapAffiliate(r: Record<string, unknown>): Affiliate {
  return {
    id: r.id as string, email: r.email as string, name: r.name as string,
    phone: (r.phone as string | null) ?? null, code: r.code as string,
    commissionPct: Number(r.commission_pct ?? 20),
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

export async function verifyAffiliateLogin(email: string, password: string): Promise<Affiliate | null> {
  const { data } = await db().from("wa_affiliates").select("*").eq("email", email.trim().toLowerCase()).maybeSingle();
  if (!data) return null;
  if (!verifyPassword(password, data.password_hash as string)) return null;
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
  status: "pending" | "paid" | "void"; paidAt: string | null; createdAt: string;
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
  const pendingCents = commissions.filter(c => c.status === "pending").reduce((s, c) => s + c.commissionCents, 0);
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
function htmlForCommission(amountRupees: string, company: string): string {
  return `<div style="font-family:sans-serif;font-size:15px;color:#111">
    <p>Good news — <strong>${company}</strong> just made a subscription payment, and you earned <strong>₹${amountRupees}</strong> in commission.</p>
    <p style="color:#666">It's recorded as pending in your affiliate dashboard. Payouts are handled manually — reach out any time to check status.</p>
  </div>`;
}

// Called after applySubscription() records an active payment. No-ops
// immediately for the overwhelming majority of tenants (no referring
// affiliate). Idempotent via the DB unique constraint — a redelivered Stripe
// webhook can safely call this again for the same billing cycle.
export async function recordAffiliateCommission(tenantId: string, p: {
  amountCents: number; plan?: string; subscriptionId?: string | null; currentPeriodEnd?: string | null;
}): Promise<void> {
  const { data: tenant } = await db().from("tenants").select("referred_by_affiliate_id, company").eq("id", tenantId).maybeSingle();
  const affiliateId = tenant?.referred_by_affiliate_id as string | null | undefined;
  if (!affiliateId) return;

  const affiliate = await getAffiliate(affiliateId);
  if (!affiliate || affiliate.status !== "active") return;

  const commissionCents = Math.round((p.amountCents * affiliate.commissionPct) / 100);
  const { error } = await db().from("wa_affiliate_commissions").insert({
    affiliate_id: affiliateId, tenant_id: tenantId,
    stripe_subscription_id: p.subscriptionId ?? null,
    period_start: new Date().toISOString(), period_end: p.currentPeriodEnd ?? null,
    plan: p.plan ?? "unknown", amount_cents: p.amountCents,
    commission_pct: affiliate.commissionPct, commission_cents: commissionCents,
  });
  // 23505 = unique_violation — this billing cycle was already recorded
  // (webhook redelivery). Not an error; just don't double-count it.
  if (error && (error as { code?: string }).code !== "23505") throw error;
  if (error) return;

  try {
    await sendEmail({
      to: affiliate.email,
      subject: subjectForCommission(),
      html: htmlForCommission((commissionCents / 100).toFixed(2), (tenant?.company as string) || "A referred business"),
    });
  } catch { /* commission is recorded regardless of email delivery */ }
}

export async function markCommissionsPaid(affiliateId: string, commissionIds: string[], actorEmail: string): Promise<void> {
  if (!commissionIds.length) return;
  const { error } = await db().from("wa_affiliate_commissions")
    .update({ status: "paid", paid_at: new Date().toISOString() })
    .eq("affiliate_id", affiliateId).in("id", commissionIds).eq("status", "pending");
  if (error) throw error;
  await ownerAudit(actorEmail, "affiliate.payout", null, `Marked ${commissionIds.length} commission(s) paid for affiliate ${affiliateId}`);
}
