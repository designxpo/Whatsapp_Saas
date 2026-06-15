import { NextResponse } from "next/server";
import { currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { getTenant } from "@/lib/tenants";
import { listPlans } from "@/lib/plans";
import { stripeConfigured } from "@/lib/stripe";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// GET — current subscription state for the tenant + the purchasable plans.
export async function GET() {
  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    const tenant = await getTenant(tid);
    const plans = (await listPlans()).filter(p => p.active);
    return NextResponse.json({
      stripeConfigured: stripeConfigured(),
      current: tenant ? {
        plan: tenant.plan,
        paymentStatus: tenant.paymentStatus,
        amountCents: tenant.amountCents,
        currency: tenant.currency,
        trialEndsAt: tenant.trialEndsAt,
        currentPeriodEnd: tenant.currentPeriodEnd,
        hasSubscription: !!tenant.stripeSubscriptionId,
        hasCustomer: !!tenant.stripeCustomerId,
      } : null,
      plans: plans.map(p => ({
        key: p.key, name: p.name, priceCents: p.priceCents, currency: p.currency, interval: p.interval,
        limits: p.limits, features: p.features, purchasable: !!p.stripePriceId,
      })),
    });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
