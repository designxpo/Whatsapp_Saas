// Editable subscription plans (owner control plane). Plans carry price, usage
// limits and default feature entitlements. Tenant.plan references plan.key.

import { db } from "./supabase";

export interface PlanLimits { contacts: number; conversations_per_month: number; messages_per_month: number; channels: number; team_seats: number; yt_comment_replies_per_day: number }
// Feature entitlements are an open key→bool map (canonical keys: FEATURE_KEYS in
// entitlements.ts). Kept as a Record so new feature keys never force a type change.
export type PlanFeatures = Record<string, boolean>;
export interface Plan {
  id: string; key: string; name: string; priceCents: number; currency: string; interval: string;
  limits: PlanLimits; features: PlanFeatures; sort: number; active: boolean;
  stripePriceId: string | null;     // Stripe Price this plan maps to (null → not purchasable via Stripe)
  razorpayPlanId: string | null;    // Razorpay Plan this maps to (null → not purchasable via Razorpay yet)
  // Months one charge covers (1, 3, 6 or 12). priceCents is the base price for that
  // WHOLE period. Absent/legacy rows read as 1 (monthly).
  billingMonths: number;
  // Hidden and unpurchasable unless eligible — see plan-eligibility.ts.
  inviteOnly: boolean;
}

export const BILLING_MONTHS = [1, 3, 6, 12] as const;

/**
 * Base price (paise) of an N-month plan: N x monthly x (1 - discountPct/100),
 * rounded to whole paise. The 6-month seeds in migration
 * 20261107130000_multi_month_plans.sql use 10% (regular) and 20% (partner:
 * 10% founding + 10% partner, off the monthly rate); this is the same formula.
 */
export function multiMonthPriceCents(monthlyCents: number, months: number, discountPct: number): number {
  return Math.round(monthlyCents * months * (100 - discountPct) / 100);
}

/** What a plan's per-month equivalent saves against the monthly plan, as a whole percent. */
export function savingsPercent(monthlyCents: number, planCents: number, months: number): number {
  if (monthlyCents <= 0 || months <= 0) return 0;
  return Math.round((1 - planCents / months / monthlyCents) * 100);
}

// yt_comment_replies_per_day: 0 = "use the platform default" (YT_REPLY_DAILY_CAP),
// NOT unlimited — the shared YouTube quota always keeps a floor. See ytcomments.ts.
const DEF_LIMITS: PlanLimits = { contacts: 0, conversations_per_month: 0, messages_per_month: 0, channels: 1, team_seats: 2, yt_comment_replies_per_day: 0 };
// Unknown/legacy plans fall back to everything-on (fail-open); real plans carry explicit flags.
const DEF_FEATURES: PlanFeatures = { whatsapp: true, instagram: true, sequences: true, commerce: true, growth: true, ai_autoreply: true, ads: true };

function mapPlan(r: Record<string, unknown>): Plan {
  return {
    id: r.id as string, key: r.key as string, name: r.name as string,
    priceCents: (r.price_cents as number) ?? 0, currency: (r.currency as string) ?? "INR", interval: (r.interval as string) ?? "month",
    limits: { ...DEF_LIMITS, ...((r.limits as Partial<PlanLimits>) ?? {}) },
    features: { ...DEF_FEATURES, ...((r.features as PlanFeatures) ?? {}) },
    sort: (r.sort as number) ?? 0, active: (r.active as boolean) ?? true,
    stripePriceId: (r.stripe_price_id as string | null) ?? null,
    razorpayPlanId: (r.razorpay_plan_id as string | null) ?? null,
    billingMonths: (r.billing_months as number | null) ?? 1,
    inviteOnly: (r.invite_only as boolean | null) ?? false,
  };
}

export async function listPlans(): Promise<Plan[]> {
  const { data } = await db().from("wa_plans").select("*").order("sort", { ascending: true });
  return (data ?? []).map(r => mapPlan(r as Record<string, unknown>));
}

// Plans change about as often as pricing does, but getPlan is on the hot path of
// every entitlement resolution — so an owner list of N tenants used to issue N
// identical point-reads. Short TTL: long enough to collapse a request's fan-out,
// short enough that an owner editing a plan sees it within seconds.
const PLAN_TTL_MS = 30_000;
const planCache = new Map<string, { at: number; plan: Plan | null }>();

/** Called by savePlan so an edit is never served stale from this process. */
export function invalidatePlanCache(key?: string): void {
  if (key) planCache.delete(key); else planCache.clear();
}

export async function getPlan(key: string): Promise<Plan | null> {
  const hit = planCache.get(key);
  if (hit && Date.now() - hit.at < PLAN_TTL_MS) return hit.plan;
  const { data } = await db().from("wa_plans").select("*").eq("key", key).maybeSingle();
  const plan = data ? mapPlan(data as Record<string, unknown>) : null;
  planCache.set(key, { at: Date.now(), plan });
  return plan;
}

// Reverse lookup used by the Stripe webhook: Price id → our plan.
export async function getPlanByStripePrice(priceId: string): Promise<Plan | null> {
  const { data } = await db().from("wa_plans").select("*").eq("stripe_price_id", priceId).maybeSingle();
  return data ? mapPlan(data as Record<string, unknown>) : null;
}

export async function savePlan(p: Partial<Plan> & { key: string; name: string }): Promise<Plan> {
  const row = {
    key: p.key.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-"), name: p.name.trim(),
    price_cents: p.priceCents ?? 0, currency: p.currency ?? "INR", interval: p.interval ?? "month",
    limits: p.limits ?? DEF_LIMITS, features: p.features ?? DEF_FEATURES, sort: p.sort ?? 0, active: p.active ?? true,
    ...(p.stripePriceId !== undefined ? { stripe_price_id: p.stripePriceId || null } : {}),
    ...(p.billingMonths !== undefined ? { billing_months: p.billingMonths } : {}),
    ...(p.inviteOnly !== undefined ? { invite_only: p.inviteOnly } : {}),
  };
  const { data, error } = await db().from("wa_plans").upsert(row, { onConflict: "key" }).select().single();
  if (error) throw error;
  invalidatePlanCache(row.key);
  return mapPlan(data as Record<string, unknown>);
}

export async function deletePlan(id: string): Promise<void> {
  await db().from("wa_plans").delete().eq("id", id);
  invalidatePlanCache();   // id, not key, in hand — drop the lot
}

// Lazily persist a plan's Razorpay Plan id the first time it's purchased —
// a targeted update rather than routing through savePlan()'s full upsert,
// since this fires mid-checkout and only ever needs to set one column.
export async function setRazorpayPlanId(key: string, razorpayPlanId: string): Promise<void> {
  const { error } = await db().from("wa_plans").update({ razorpay_plan_id: razorpayPlanId }).eq("key", key);
  if (error) throw error;
  invalidatePlanCache(key);
}
