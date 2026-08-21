import { NextResponse } from "next/server";
import { verifyRazorpayWebhook } from "@/lib/razorpay";
import { applySubscription, getTenantByRazorpaySubscription, getTenant, type PaymentStatus, type TenantStatus } from "@/lib/tenants";
import { getPlan } from "@/lib/plans";
import { computeChargeBreakdown } from "@/lib/billing-tax";
import { recordBillingEvent, recordActualGatewayFee } from "@/lib/billing-events";
import { notifyPaymentFailed, notifyServiceSuspended } from "@/lib/dunning";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// Razorpay SUBSCRIPTION lifecycle webhook — separate from
// webhooks/razorpay/route.ts, which stays scoped to payment_link.paid for
// one-off in-chat commerce. Keeping them apart avoids one handler's event
// switch growing two unrelated domains (subscriptions vs. one-time orders).
//
// Configure in Razorpay Dashboard → Settings → Webhooks, pointing at
// /api/webhooks/razorpay/subscriptions with the events below checked, and set
// the same secret as RAZORPAY_SUBSCRIPTIONS_WEBHOOK_SECRET (a separate secret
// from RAZORPAY_WEBHOOK_SECRET, since it's configured as a separate endpoint).

type RzpSubscriptionStatus = "authenticated" | "activated" | "charged" | "pending" | "halted" | "completed" | "cancelled";

// Razorpay subscription.status → our payment/tenant status. Mirrors
// mapStatus() in webhooks/stripe/route.ts's shape and intent exactly.
function mapStatus(event: string): { payment: PaymentStatus; tenant: TenantStatus } {
  switch (event) {
    case "subscription.activated":
    case "subscription.charged":       return { payment: "active", tenant: "active" };
    case "subscription.pending":       return { payment: "past_due", tenant: "active" };
    case "subscription.halted":        return { payment: "past_due", tenant: "suspended" };
    case "subscription.cancelled":     return { payment: "cancelled", tenant: "cancelled" };
    case "subscription.completed":     return { payment: "cancelled", tenant: "cancelled" };
    default:                           return { payment: "active", tenant: "active" };   // authenticated, updated — no status change implied
  }
}

interface RzpWebhookBody {
  event: string;
  payload?: {
    subscription?: { entity?: { id?: string; current_end?: number; paid_count?: number; notes?: Record<string, string> } };
    // fee/tax are Razorpay's ACTUAL gateway fee and the GST on that fee for
    // this specific payment (in paise) — only present once the charge is
    // fully processed, distinct from the checkout-time ESTIMATE this route
    // otherwise relies on (see src/lib/billing-tax.ts).
    payment?: { entity?: { id?: string; amount?: number; currency?: string; fee?: number; tax?: number } };
  };
}

export async function POST(req: Request) {
  const raw = await req.text();
  const sig = req.headers.get("x-razorpay-signature") ?? "";
  const secret = process.env.RAZORPAY_SUBSCRIPTIONS_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "webhook not configured" }, { status: 503 });
  if (!verifyRazorpayWebhook(raw, sig, secret)) return NextResponse.json({ error: "invalid signature" }, { status: 401 });

  let event: RzpWebhookBody;
  try { event = JSON.parse(raw); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }

  const HANDLED = new Set([
    "subscription.authenticated", "subscription.activated", "subscription.charged",
    "subscription.pending", "subscription.halted", "subscription.completed", "subscription.cancelled",
  ]);
  if (!HANDLED.has(event.event)) return NextResponse.json({ received: true });   // subscription.updated etc — ignored for now

  try {
    const subId = event.payload?.subscription?.entity?.id;
    if (!subId) return NextResponse.json({ received: true });
    const tenant = await getTenantByRazorpaySubscription(subId);
    if (!tenant) { console.warn("[razorpay webhook] no tenant for subscription", subId); return NextResponse.json({ received: true }); }

    const { payment, tenant: tenantStatus } = mapStatus(event.event);
    const currentEndUnix = event.payload?.subscription?.entity?.current_end;
    const pay = event.payload?.payment?.entity;

    // Read prior state BEFORE the write — the suspension email must fire on
    // the transition INTO suspended, not on every event that finds us already
    // there. Same reasoning as the Stripe webhook's `before` read.
    const before = event.event === "subscription.halted" ? await getTenant(tenant.id).catch(() => null) : null;

    // Recompute the GST/gateway-fee breakdown from the tenant's CURRENT plan
    // (not from Razorpay's reported amount) so every renewal's breakdown
    // matches what checkout originally recorded, exactly as the verify route
    // does for the first payment — the plan's base price is the one number
    // both sides agree on, avoiding rounding drift.
    const planKey = event.payload?.subscription?.entity?.notes?.plan ?? tenant.plan;
    const plan = planKey ? await getPlan(planKey) : null;
    const isCharge = event.event === "subscription.charged";
    const breakdown = isCharge ? computeChargeBreakdown(plan?.priceCents ?? pay?.amount ?? 0) : null;

    await applySubscription(tenant.id, {
      paymentStatus: payment,
      status: tenantStatus,
      subscriptionId: subId,
      provider: "razorpay",
      currentPeriodEnd: currentEndUnix ? new Date(currentEndUnix * 1000).toISOString() : undefined,
      // Only a real charge carries an amount; authenticated/updated events don't.
      amountCents: breakdown?.totalChargedCents,
      baseAmountCents: breakdown?.baseAmountCents, taxCents: breakdown?.taxCents, gatewayFeeEstimateCents: breakdown?.gatewayFeeEstimateCents,
      currency: pay?.currency ? pay.currency.toUpperCase() : undefined,
    });

    if (isCharge && breakdown) {
      await recordBillingEvent(tenant.id, {
        provider: "razorpay", providerPaymentId: pay?.id, currency: pay?.currency?.toUpperCase() ?? "INR", breakdown,
      }).catch(err => console.error(JSON.stringify({ at: "razorpay.subscriptions.recordBillingEvent", tenantId: tenant.id, error: errorMessage(err) })));
      // The REAL fee Razorpay took on this specific payment, replacing the
      // checkout-time estimate for accurate net-revenue reporting.
      if (pay?.id && typeof pay.fee === "number") {
        await recordActualGatewayFee(pay.id, pay.fee, pay.tax ?? 0)
          .catch(err => console.error(JSON.stringify({ at: "razorpay.subscriptions.recordActualGatewayFee", tenantId: tenant.id, error: errorMessage(err) })));
      }
    }

    if (event.event === "subscription.pending" && pay?.id) {
      await notifyPaymentFailed(tenant, {
        invoiceId: pay.id, attempt: 1,
        amountCents: typeof pay.amount === "number" ? pay.amount : 0,
        currency: (pay.currency ?? "inr").toLowerCase(),
        nextAttemptISO: null,   // Razorpay doesn't report the next retry time in this payload
        invoiceUrl: null,       // no Razorpay equivalent of Stripe's hosted invoice page
      });
    }
    if (event.event === "subscription.halted" && before && before.status !== "suspended") {
      await notifyServiceSuspended(before, subId);
    }
  } catch (err) {
    console.error("[razorpay subscriptions webhook]", event.event, err);   // 200 anyway so Razorpay doesn't storm retries on a transient DB error
  }
  return NextResponse.json({ received: true });
}
