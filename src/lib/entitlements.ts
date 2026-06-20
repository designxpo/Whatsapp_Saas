// Entitlement resolver (server) — the single function every gate reads from.
// effective features = grandfathered ? all-on : (plan defaults ⊕ sparse tenant
// overrides). Fail-open everywhere: a read error or unknown key never locks a
// tenant out, and the whole system is dormant until the enforce_entitlements
// platform flag is switched on.

import { db } from "./supabase";
import { DEFAULT_TENANT_ID } from "./tenant";
import { getPlan, listPlans } from "./plans";
import { getFlag } from "./flags";
import { getTenantUsage } from "./usage";
import {
  FEATURE_KEYS, type FeatureKey, type Entitlements, type EntitlementLimits,
} from "./entitlement-registry";

const UNLIMITED: EntitlementLimits = { contacts: 0, conversations_per_month: 0, messages_per_month: 0, channels: 0, team_seats: 0 };

function allOn(): Record<FeatureKey, boolean> {
  return Object.fromEntries(FEATURE_KEYS.map(k => [k, true])) as Record<FeatureKey, boolean>;
}

// Legacy override keys (pre-0059 tenant.features / owner toggles) → new keys, so
// existing per-tenant overrides keep working through the transition.
const LEGACY_TO_NEW: Record<string, FeatureKey> = { whatsapp: "ch_whatsapp", instagram: "ch_instagram" };

export async function isEnforcing(): Promise<boolean> {
  return getFlag("enforce_entitlements", false);
}

export async function getEntitlements(tenantId: string, opts?: { withUsage?: boolean }): Promise<Entitlements> {
  const enforcing = await isEnforcing();

  // The platform owner's own workspace is always fully entitled.
  if (tenantId === DEFAULT_TENANT_ID) {
    const usage = opts?.withUsage ? await getTenantUsage(tenantId).catch(() => undefined) : undefined;
    return { features: allOn(), limits: UNLIMITED, usage, plan: "owner", status: "active", paymentStatus: "active", trialEndsAt: null, enforcing, grandfathered: true };
  }

  try {
    const { data } = await db().from("tenants")
      .select("plan, features, grandfathered, status, payment_status, trial_ends_at")
      .eq("id", tenantId).maybeSingle();
    const grandfathered = (data?.grandfathered as boolean) ?? false;
    const plan = data ? await getPlan(data.plan as string) : null;
    const raw = (data?.features as Record<string, boolean>) ?? {};

    const features = {} as Record<FeatureKey, boolean>;
    for (const k of FEATURE_KEYS) {
      if (grandfathered) { features[k] = true; continue; }
      const legacyKey = Object.keys(LEGACY_TO_NEW).find(lk => LEGACY_TO_NEW[lk] === k);
      const override = raw[k] ?? (legacyKey ? raw[legacyKey] : undefined);
      const planDefault = plan?.features?.[k];
      features[k] = override ?? planDefault ?? true;   // fail-open on unknown
    }

    const usage = opts?.withUsage ? await getTenantUsage(tenantId).catch(() => undefined) : undefined;
    return {
      features,
      limits: plan?.limits ?? UNLIMITED,
      usage,
      plan: (data?.plan as string) ?? "trial",
      status: (data?.status as string) ?? "active",
      paymentStatus: (data?.payment_status as string) ?? "none",
      trialEndsAt: (data?.trial_ends_at as string | null) ?? null,
      enforcing, grandfathered,
    };
  } catch {
    // Never lock anyone out on an error.
    return { features: allOn(), limits: UNLIMITED, plan: "trial", status: "active", paymentStatus: "none", trialEndsAt: null, enforcing, grandfathered: true };
  }
}

// True if the tenant is allowed to use a feature. Respects the kill-switch: when
// enforcement is off, everything passes.
export async function hasFeature(tenantId: string, feature: FeatureKey): Promise<boolean> {
  const ent = await getEntitlements(tenantId);
  return !ent.enforcing || ent.features[feature] === true;
}

export interface FeatureGate { ok: boolean; enforcing: boolean; feature: FeatureKey; upgradeTo: string | null }

// Gate used by API routes. ok=true when allowed (or enforcement off). When
// blocked, upgradeTo names the cheapest active plan that includes the feature.
export async function checkFeature(tenantId: string, feature: FeatureKey): Promise<FeatureGate> {
  const ent = await getEntitlements(tenantId);
  const ok = !ent.enforcing || ent.features[feature] === true;
  let upgradeTo: string | null = null;
  if (!ok) upgradeTo = await suggestPlanForFeature(feature);
  return { ok, enforcing: ent.enforcing, feature, upgradeTo };
}

// Cheapest active plan whose defaults include the feature (for upgrade prompts).
export async function suggestPlanForFeature(feature: FeatureKey): Promise<string | null> {
  try {
    const plans = (await listPlans())
      .filter(p => p.active && p.features?.[feature] === true)
      .sort((a, b) => a.priceCents - b.priceCents);
    return plans[0]?.name ?? null;
  } catch { return null; }
}
