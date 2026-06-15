export const maxDuration = 60;
import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { verifyWebhook } from "@/lib/stripe";
import { applySubscription, setStripeIds, getTenantByStripeCustomer, type PaymentStatus, type TenantStatus } from "@/lib/tenants";
import { getPlanByStripePrice } from "@/lib/plans";

export const dynamic = "force-dynamic";

// Stripe subscription.status → our payment/tenant status.
function mapStatus(s: string): { payment: PaymentStatus; tenant: TenantStatus } {
  switch (s) {
    case "trialing":   return { payment: "trialing", tenant: "trialing" };
    case "active":     return { payment: "active",   tenant: "active" };
    case "past_due":   return { payment: "past_due", tenant: "active" };
    case "unpaid":     return { payment: "past_due", tenant: "suspended" };
    case "canceled":   return { payment: "cancelled", tenant: "cancelled" };
    default:           return { payment: "none",     tenant: "suspended" };  // incomplete / paused
  }
}

// Resolve our tenant id from a subscription's metadata or its customer.
async function tenantIdFromSub(sub: Stripe.Subscription): Promise<string | null> {
  const metaId = sub.metadata?.tenant_id;
  if (metaId) return metaId;
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
  if (!customerId) return null;
  const t = await getTenantByStripeCustomer(customerId);
  return t?.id ?? null;
}

async function syncSubscription(sub: Stripe.Subscription): Promise<void> {
  const tenantId = await tenantIdFromSub(sub);
  if (!tenantId) { console.warn("[stripe] no tenant for subscription", sub.id); return; }

  const item = sub.items?.data?.[0];
  const price = item?.price;
  const plan = price?.id ? await getPlanByStripePrice(price.id) : null;
  const periodEndUnix = (sub as unknown as { current_period_end?: number }).current_period_end
    ?? (item as unknown as { current_period_end?: number })?.current_period_end;
  const { payment, tenant } = mapStatus(sub.status);

  // Ensure the customer id is on the tenant (idempotent).
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
  if (customerId) await setStripeIds(tenantId, { customerId });

  await applySubscription(tenantId, {
    plan: plan?.key,
    paymentStatus: payment,
    status: tenant,
    amountCents: typeof price?.unit_amount === "number" ? price.unit_amount : undefined,
    currency: price?.currency ? price.currency.toUpperCase() : undefined,
    currentPeriodEnd: periodEndUnix ? new Date(periodEndUnix * 1000).toISOString() : undefined,
    subscriptionId: sub.id,
  });
}

export async function POST(req: Request) {
  const raw = await req.text();
  const sig = req.headers.get("stripe-signature") ?? "";
  let event: Stripe.Event;
  try {
    event = verifyWebhook(raw, sig);
  } catch (err) {
    return NextResponse.json({ error: `Webhook signature failed: ${err instanceof Error ? err.message : err}` }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object as Stripe.Checkout.Session;
        const tenantId = s.metadata?.tenant_id;
        const customerId = typeof s.customer === "string" ? s.customer : s.customer?.id;
        const subscriptionId = typeof s.subscription === "string" ? s.subscription : s.subscription?.id;
        if (tenantId && (customerId || subscriptionId)) {
          await setStripeIds(tenantId, { customerId, subscriptionId: subscriptionId ?? undefined });
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        await syncSubscription(event.data.object as Stripe.Subscription);
        break;
      }
      case "invoice.payment_failed": {
        const inv = event.data.object as Stripe.Invoice;
        const customerId = typeof inv.customer === "string" ? inv.customer : inv.customer?.id;
        if (customerId) {
          const t = await getTenantByStripeCustomer(customerId);
          if (t) await applySubscription(t.id, { paymentStatus: "past_due" });
        }
        break;
      }
      default:
        break;   // ignore other events
    }
  } catch (err) {
    console.error("[stripe webhook]", event.type, err);
    // 200 anyway so Stripe doesn't hammer retries on a transient DB hiccup; we log it.
  }
  return NextResponse.json({ received: true });
}
