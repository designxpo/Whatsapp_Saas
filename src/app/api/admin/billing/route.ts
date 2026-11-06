import { NextResponse } from "next/server";
import { currentTenantId, noSession } from "@/lib/auth";
import { getTenant } from "@/lib/tenants";
import { listPlans } from "@/lib/plans";
import { stripeConfigured, getStripePriceSummary } from "@/lib/stripe";
import { razorpayConfigured, RAZORPAY_INTERVAL } from "@/lib/razorpay";
import { computeChargeBreakdown } from "@/lib/billing-tax";
import { billingProvider, hasLiveSubscription, readCancelAt } from "@/lib/billing-cancel";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// GET — current subscription state for the tenant + the purchasable plans.
export async function GET() {
  try {
    const tid = await currentTenantId();
    if (!tid) return noSession();
    const tenant = await getTenant(tid);
    const plans = (await listPlans()).filter(p => p.active);
    const stripeOn = stripeConfigured();
    // What Stripe will really charge for each plan — its Price, as set in the
    // Stripe dashboard. Not the Razorpay gross-up below: Stripe Checkout bills
    // the Price as-is. A plan whose Price can't be read isn't offered via
    // Stripe at all, rather than sold under a number we can't vouch for.
    const stripePrices = new Map(await Promise.all(plans.map(async p =>
      [p.key, stripeOn && p.stripePriceId ? await getStripePriceSummary(p.stripePriceId) : null] as const)));
    const provider = tenant ? billingProvider(tenant) : null;
    const cancelAt = tenant && provider ? await readCancelAt(tenant) : null;
    return NextResponse.json({
      stripeConfigured: stripeConfigured(),
      razorpayConfigured: razorpayConfigured(),
      current: tenant ? {
        plan: tenant.plan,
        paymentStatus: tenant.paymentStatus,
        amountCents: tenant.amountCents,
        currency: tenant.currency,
        trialEndsAt: tenant.trialEndsAt,
        currentPeriodEnd: tenant.currentPeriodEnd,
        hasSubscription: !!tenant.stripeSubscriptionId || !!tenant.razorpaySubscriptionId,
        hasCustomer: !!tenant.stripeCustomerId,
        // Who bills this workspace, and whether it's been told not to renew
        // (the plan stays active until cancelAt). Drives the Cancel button.
        provider,
        cancelAt,
        canCancel: hasLiveSubscription(tenant) && !cancelAt,
      } : null,
      plans: plans.map(p => ({
        key: p.key, name: p.name, priceCents: p.priceCents, currency: p.currency, interval: p.interval,
        limits: p.limits, features: p.features, purchasable: !!p.stripePriceId && !!stripePrices.get(p.key),
        // The exact amount and cadence Stripe charges, or null (not offered via Stripe).
        stripe: stripePrices.get(p.key) ?? null,
        // Every Razorpay Plan this app creates bills monthly (razorpay.ts).
        razorpayInterval: RAZORPAY_INTERVAL,
        // Unlike Stripe (where a price id must be configured per-plan up
        // front), a Razorpay Plan is created lazily on first checkout attempt
        // (getOrCreateRazorpayPlan()) — so every active plan is purchasable
        // via Razorpay as soon as the platform-wide keys are set, with no
        // per-plan setup step.
        purchasableViaRazorpay: razorpayConfigured(),
        // Full GST + estimated gateway-fee breakdown — Razorpay's own checkout
        // modal only ever shows one total, so the itemized breakdown has to be
        // rendered on THIS page, before checkout opens. Computed here so the
        // page never duplicates this math client-side (src/lib/billing-tax.ts
        // is the single source of truth).
        ...computeChargeBreakdown(p.priceCents),
      })),
    });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
