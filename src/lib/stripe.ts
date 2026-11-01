// Stripe billing — subscription checkout, customer billing portal, and webhook
// verification. Everything degrades gracefully when STRIPE_SECRET_KEY is unset
// (stripeConfigured() === false) so the app still builds/runs without keys.

import Stripe from "stripe";
import type { Tenant } from "./tenants";
import type { Plan } from "./plans";
import { setStripeIds } from "./tenants";

let client: Stripe | null = null;

export function stripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

export function stripe(): Stripe {
  if (!client) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY not configured");
    client = new Stripe(key);
  }
  return client;
}

// Ensure the tenant has a Stripe customer; create + persist on first use.
export async function getOrCreateCustomer(tenant: Tenant): Promise<string> {
  if (tenant.stripeCustomerId) return tenant.stripeCustomerId;
  const customer = await stripe().customers.create({
    name: tenant.company ?? tenant.name,
    email: tenant.ownerEmail ?? undefined,
    metadata: { tenant_id: tenant.id, slug: tenant.slug },
  });
  await setStripeIds(tenant.id, { customerId: customer.id });
  return customer.id;
}

// Hosted Checkout for a subscription to `plan`. Returns the redirect URL.
export async function createCheckoutSession(tenant: Tenant, plan: Plan, baseUrl: string): Promise<string> {
  if (!plan.stripePriceId) throw new Error(`Plan "${plan.key}" has no Stripe price configured`);
  const customerId = await getOrCreateCustomer(tenant);
  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: plan.stripePriceId, quantity: 1 }],
    success_url: `${baseUrl}/admin/billing?status=success`,
    cancel_url: `${baseUrl}/admin/billing?status=cancelled`,
    allow_promotion_codes: true,
    subscription_data: { metadata: { tenant_id: tenant.id, plan: plan.key } },
    metadata: { tenant_id: tenant.id, plan: plan.key },
  });
  if (!session.url) throw new Error("Stripe did not return a checkout URL");
  return session.url;
}

// Stripe-hosted billing portal (update card, cancel, invoices). Returns the URL.
//
// `cancel` opens the portal straight on its cancel-subscription screen, so the
// billing page's "Cancel subscription" button is one confirmation away from
// done rather than a tour of the portal. Whether that cancels now or at the
// period end, and whether Stripe shows a reason survey or a retention coupon
// first, is set in the Stripe dashboard's portal settings, not here.
export async function createBillingPortalSession(tenant: Tenant, returnUrl: string, opts: { cancel?: boolean } = {}): Promise<string> {
  if (!tenant.stripeCustomerId) throw new Error("No Stripe customer for this tenant yet — subscribe first");
  const session = await stripe().billingPortal.sessions.create({
    customer: tenant.stripeCustomerId,
    return_url: returnUrl,
    ...(opts.cancel && tenant.stripeSubscriptionId ? {
      flow_data: {
        type: "subscription_cancel" as const,
        subscription_cancel: { subscription: tenant.stripeSubscriptionId },
        after_completion: { type: "redirect" as const, redirect: { return_url: returnUrl } },
      },
    } : {}),
  });
  return session.url;
}

export interface StripePriceSummary { amountCents: number; currency: string; interval: string; intervalCount: number }

// What Stripe will actually charge for a price id. Checkout bills
// plan.stripePriceId exactly as configured in the Stripe dashboard — none of
// the billing-tax.ts gross-up applies — so the billing page must quote THIS
// number, not the Razorpay figure. Cached briefly: the page asks for every
// plan on every load. Null when the price can't be read or isn't a simple
// recurring per-unit price, which the page treats as "can't quote, don't sell".
const PRICE_TTL_MS = 10 * 60_000;
const priceCache = new Map<string, { at: number; v: StripePriceSummary | null }>();
export async function getStripePriceSummary(priceId: string): Promise<StripePriceSummary | null> {
  const hit = priceCache.get(priceId);
  if (hit && Date.now() - hit.at < PRICE_TTL_MS) return hit.v;
  let v: StripePriceSummary | null = null;
  try {
    const p = await stripe().prices.retrieve(priceId);
    if (typeof p.unit_amount === "number" && p.recurring && p.active !== false) {
      v = { amountCents: p.unit_amount, currency: p.currency.toUpperCase(), interval: p.recurring.interval, intervalCount: p.recurring.interval_count ?? 1 };
    }
  } catch (err) {
    console.error(JSON.stringify({ at: "stripe.getStripePriceSummary", priceId, error: err instanceof Error ? err.message : String(err) }));
  }
  priceCache.set(priceId, { at: Date.now(), v });
  return v;
}

// Verify + parse a webhook payload against STRIPE_WEBHOOK_SECRET (platform
// billing account).
export function verifyWebhook(rawBody: string, signature: string): Stripe.Event {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET not configured");
  return stripe().webhooks.constructEvent(rawBody, signature, secret);
}

// Verify + parse a webhook payload against an EXPLICIT signing secret — used for
// per-tenant order webhooks, where each tenant's own Stripe account has its own
// `whsec_…`. constructEvent is pure crypto (no API call), so it works even when
// the platform never set STRIPE_SECRET_KEY; a bare client is fine for verifying.
let verifyOnlyClient: Stripe | null = null;
export function verifyWebhookWith(rawBody: string, signature: string, secret: string): Stripe.Event {
  if (!secret) throw new Error("stripe webhook secret missing");
  if (!verifyOnlyClient) verifyOnlyClient = process.env.STRIPE_SECRET_KEY ? stripe() : new Stripe("sk_signature_verification_only");
  return verifyOnlyClient.webhooks.constructEvent(rawBody, signature, secret);
}
