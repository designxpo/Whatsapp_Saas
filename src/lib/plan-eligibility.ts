// Who may BUY an invite-only plan. Enforced server-side in both the billing
// listing (invite-only plans a tenant cannot buy are omitted, never merely
// hidden by the UI) and the checkout POST (a hand-typed planKey gets a 403).
//
// Rules (wa_plans.invite_only = true):
//   (a) GRANT: a wa_plan_grants row exists for (tenant, plan.key). The owner
//       creates these via POST /api/owner/plan-grants. Works for any
//       invite-only plan, partner plans included.
//   (b) PARTNER: only for plan keys ending in "-partner". The tenant's owner
//       email (case-insensitive) equals the email of an ACTIVE wa_affiliates
//       row, AND that affiliate has at least PARTNER_MIN_CONVERTED referred
//       tenants (tenants.referred_by_affiliate_id) that are:
//         - payment_status = 'active'
//         - status not 'suspended' (nor 'cancelled')
//         - NOT owned by the affiliate's own email (self-referrals don't count)
//         - has at least one EARNING commission for this affiliate that is
//           not flagged (self-referral / velocity / dispute), not void, and
//           past its refund hold (payable_at <= now). A referral that is still
//           inside the 10-day refund window, or that our risk checks flagged,
//           does not unlock a discount.
//       Each referred tenant counts once.
//   Non-invite-only plans are always purchasable (this module says nothing
//   about the separate "already has a live subscription" guard in checkout).
//
// Fails closed: a database error means "not eligible", never "eligible".

import { db } from "./supabase";
import type { Plan } from "./plans";

export const PARTNER_PLAN_SUFFIX = "-partner";

export function partnerMinConverted(): number {
  const n = Number(process.env.PARTNER_MIN_CONVERTED);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 3;
}

export const isPartnerPlanKey = (key: string) => key.endsWith(PARTNER_PLAN_SUFFIX);

export interface ReferredTenantRow { id?: string; status?: string | null; payment_status?: string | null; owner_email?: string | null }

/** Pure: how many referred tenants count toward the partner threshold. */
export function countConvertedReferrals(referred: ReferredTenantRow[], affiliateEmail: string, settledTenantIds?: Set<string>): number {
  const aff = affiliateEmail.trim().toLowerCase();
  return referred.filter(t =>
    (!settledTenantIds || (!!t.id && settledTenantIds.has(t.id))) &&
    t.payment_status === "active"
    && t.status !== "suspended" && t.status !== "cancelled"
    && (t.owner_email ?? "").trim().toLowerCase() !== aff,
  ).length;
}

async function hasGrant(tenantId: string, planKey: string): Promise<boolean> {
  const { data, error } = await db().from("wa_plan_grants").select("plan_key").eq("tenant_id", tenantId).eq("plan_key", planKey).maybeSingle();
  return !error && !!data;
}

async function grantedKeys(tenantId: string): Promise<Set<string>> {
  const { data, error } = await db().from("wa_plan_grants").select("plan_key").eq("tenant_id", tenantId);
  if (error) return new Set();
  return new Set((data ?? []).map(r => (r as { plan_key: string }).plan_key));
}

export async function qualifiesAsPartner(ownerEmail: string | null | undefined): Promise<boolean> {
  const email = ownerEmail?.trim().toLowerCase();
  if (!email) return false;
  const { data: aff, error } = await db().from("wa_affiliates").select("id, email, status").eq("email", email).maybeSingle();
  if (error || !aff || (aff as { status: string }).status !== "active") return false;
  const { data: refs, error: e2 } = await db().from("tenants").select("id, status, payment_status, owner_email").eq("referred_by_affiliate_id", (aff as { id: string }).id);
  if (e2) return false;
  const { data: settled, error: e3 } = await db().from("wa_affiliate_commissions").select("tenant_id")
    .eq("affiliate_id", (aff as { id: string }).id).eq("kind", "earning").eq("flagged", false)
    .in("status", ["pending", "processing", "paid"]).lte("payable_at", new Date().toISOString());
  if (e3) return false;
  const settledIds = new Set((settled ?? []).map(r => (r as { tenant_id: string }).tenant_id));
  return countConvertedReferrals((refs ?? []) as ReferredTenantRow[], email, settledIds) >= partnerMinConverted();
}

interface TenantLike { id: string; ownerEmail: string | null }

/** May `tenant` buy `plan`? */
export async function canPurchasePlan(tenant: TenantLike, plan: Pick<Plan, "key" | "inviteOnly">): Promise<boolean> {
  if (!plan.inviteOnly) return true;
  try {
    if (await hasGrant(tenant.id, plan.key)) return true;
    if (isPartnerPlanKey(plan.key)) return await qualifiesAsPartner(tenant.ownerEmail);
  } catch { /* fail closed */ }
  return false;
}

/** Listing filter: drops every invite-only plan the tenant cannot buy. No tenant → drops all of them. */
export async function filterPurchasablePlans<T extends Pick<Plan, "key" | "inviteOnly">>(tenant: TenantLike | null, plans: T[]): Promise<T[]> {
  const invite = plans.filter(p => p.inviteOnly);
  if (!invite.length) return plans;
  if (!tenant) return plans.filter(p => !p.inviteOnly);
  let granted = new Set<string>();
  try { granted = await grantedKeys(tenant.id); } catch { /* fail closed */ }
  let partner: boolean | null = null;   // computed at most once, only if a partner plan is in play
  const ok = new Set<string>();
  for (const p of invite) {
    if (granted.has(p.key)) { ok.add(p.key); continue; }
    if (isPartnerPlanKey(p.key)) {
      if (partner === null) partner = await qualifiesAsPartner(tenant.ownerEmail).catch(() => false);
      if (partner) ok.add(p.key);
    }
  }
  return plans.filter(p => !p.inviteOnly || ok.has(p.key));
}
