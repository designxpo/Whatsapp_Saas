// Editable subscription plans (owner control plane). Plans carry price, usage
// limits and default feature entitlements. Tenant.plan references plan.key.

import { db } from "./supabase";

export interface PlanLimits { contacts: number; conversations_per_month: number; messages_per_month: number; channels: number; team_seats: number }
// Feature entitlements are an open key→bool map (canonical keys: FEATURE_KEYS in
// entitlements.ts). Kept as a Record so new feature keys never force a type change.
export type PlanFeatures = Record<string, boolean>;
export interface Plan {
  id: string; key: string; name: string; priceCents: number; currency: string; interval: string;
  limits: PlanLimits; features: PlanFeatures; sort: number; active: boolean;
  stripePriceId: string | null;   // Stripe Price this plan maps to (null → not purchasable via Stripe)
}

const DEF_LIMITS: PlanLimits = { contacts: 0, conversations_per_month: 0, messages_per_month: 0, channels: 1, team_seats: 2 };
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
  };
}

export async function listPlans(): Promise<Plan[]> {
  const { data } = await db().from("wa_plans").select("*").order("sort", { ascending: true });
  return (data ?? []).map(r => mapPlan(r as Record<string, unknown>));
}

export async function getPlan(key: string): Promise<Plan | null> {
  const { data } = await db().from("wa_plans").select("*").eq("key", key).maybeSingle();
  return data ? mapPlan(data as Record<string, unknown>) : null;
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
  };
  const { data, error } = await db().from("wa_plans").upsert(row, { onConflict: "key" }).select().single();
  if (error) throw error;
  return mapPlan(data as Record<string, unknown>);
}

export async function deletePlan(id: string): Promise<void> {
  await db().from("wa_plans").delete().eq("id", id);
}
