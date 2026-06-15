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
export async function createBillingPortalSession(tenant: Tenant, returnUrl: string): Promise<string> {
  if (!tenant.stripeCustomerId) throw new Error("No Stripe customer for this tenant yet — subscribe first");
  const session = await stripe().billingPortal.sessions.create({
    customer: tenant.stripeCustomerId,
    return_url: returnUrl,
  });
  return session.url;
}

// Verify + parse a webhook payload against STRIPE_WEBHOOK_SECRET.
export function verifyWebhook(rawBody: string, signature: string): Stripe.Event {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET not configured");
  return stripe().webhooks.constructEvent(rawBody, signature, secret);
}
