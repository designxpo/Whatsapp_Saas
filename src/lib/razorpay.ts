// Razorpay Subscriptions — recurring billing (NOT Standard Checkout, which is
// one-time-payment only). Raw fetch against the REST API with HTTP Basic Auth,
// matching the existing webhooks/razorpay/route.ts convention of no SDK
// dependency, rather than adding the `razorpay` npm package for this alone.
//
// Key API facts (razorpay.com/docs/payments/subscriptions/):
// - A Plan is immutable once created — a price change needs a NEW Plan, so
//   plans are created lazily and cached (wa_plans.razorpay_plan_id), never edited.
// - A Subscription needs plan_id + total_count (no "run forever" flag exists);
//   INDEFINITE_CYCLES below is the documented workaround.
// - Checkout.js for a subscription passes subscription_id, and — unlike order-
//   based Standard Checkout — omits amount/currency entirely; the Plan defines
//   the charge.
// - The post-checkout signature formula is payment_id-first, DIFFERENT from
//   Standard Checkout's order_id-first formula — see verifySubscriptionSignature.

import crypto from "crypto";
import type { Tenant } from "./tenants";
import type { Plan } from "./plans";
import { setRazorpayPlanId } from "./plans";
import { setRazorpayIds } from "./tenants";
import { computeChargeBreakdown } from "./billing-tax";

// Razorpay's Subscription API requires total_count and has no indefinite-billing
// flag, so this stands in for "keep billing until cancelled".
//
// 360 = exactly 30 years of monthly cycles, which is the only value that is safe
// under every ceiling that applies:
//   • NPCI/UPI/OC 123/2021-22 (3 Nov 2021), item 1: "The PSPs of the Merchants
//     and Aggregators are advised to create the Recurring Mandates with a
//     maximum validity of 30 years." This is the strictest limit anywhere, and
//     it governs the UPI Autopay leg — the one that renders a mandate QR.
//   • NPCI/NACH/OC No.012/2023-24 (effective 1 Apr 2024) caps NACH mandates at
//     40 years from issuance.
//   • Razorpay's own docs, which CONTRADICT THEMSELVES: the Subscriptions FAQ
//     and the create-subscription API reference both say "maximum duration of
//     100 years", while the subscription-links page says "a maximum of 30
//     years" and then prints the monthly formula as "(12 * 30)/1 = 1200".
//     That arithmetic is wrong — 12 × 30 is 360, and 1200 months is 100 years.
//     360 is what that formula should produce, so it is defensible under either
//     reading and needs no resolution of the contradiction.
//
// Do NOT raise this toward 1200: that implies a ~100-year mandate, past both
// NPCI ceilings. 30 years of monthly billing is indistinguishable from "forever"
// for a SaaS subscription.
//
// Note for anyone debugging a missing UPI QR at checkout: this is not a known
// cause. Razorpay nowhere documents deriving UPI mandate validity from
// total_count. Check whether UPI Autopay is enabled on the Razorpay account
// first — it is an opt-in toggle, and that is the ordinary reason the QR fails
// to render.
const INDEFINITE_CYCLES = 360;

export function razorpayConfigured(): boolean {
  return !!process.env.RAZORPAY_KEY_ID && !!process.env.RAZORPAY_KEY_SECRET;
}

function authHeader(): string {
  const id = process.env.RAZORPAY_KEY_ID;
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!id || !secret) throw new Error("RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET not configured");
  return `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
}

async function rzp<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`https://api.razorpay.com/v1${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: authHeader(), ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (body as { error?: { description?: string } })?.error?.description ?? `Razorpay API error (HTTP ${res.status})`;
    throw new Error(msg);
  }
  return body as T;
}

// Get this plan's Razorpay Plan id, creating one on first use. A Plan is
// immutable once created, so this never re-syncs price changes onto an
// existing Razorpay Plan — a price change on our side needs a new plan.key
// (or a manual reset of razorpay_plan_id) to take effect on the Razorpay side.
//
// The amount charged is the ALL-INCLUSIVE total, not plan.priceCents directly:
// wa_plans.price_cents is the base, and computeChargeBreakdown() grosses it up
// so Razorpay's cut comes out of the markup rather than the base. NO GST is
// added — the company has no GSTIN (see src/lib/billing-tax.ts). Baked in once
// at Plan creation, same as the price itself, which is exactly why a pricing
// change requires minting a new Plan.
export async function getOrCreateRazorpayPlan(plan: Plan): Promise<string> {
  if (plan.razorpayPlanId) return plan.razorpayPlanId;
  const { totalChargedCents } = computeChargeBreakdown(plan.priceCents);
  const created = await rzp<{ id: string }>("/plans", {
    method: "POST",
    body: JSON.stringify({
      period: "monthly", interval: 1,
      item: { name: `Talko AI — ${plan.name}`, amount: totalChargedCents, currency: plan.currency },
      notes: { plan_key: plan.key },
    }),
  });
  await setRazorpayPlanId(plan.key, created.id);
  return created.id;
}

export async function getOrCreateRazorpayCustomer(tenant: Tenant): Promise<string | undefined> {
  if (tenant.razorpayCustomerId) return tenant.razorpayCustomerId;
  if (!tenant.ownerEmail) return undefined;   // customer is optional on a subscription; skip rather than fail
  try {
    const customer = await rzp<{ id: string }>("/customers", {
      method: "POST",
      body: JSON.stringify({ name: tenant.company ?? tenant.name, email: tenant.ownerEmail, contact: tenant.ownerPhone ?? undefined, notes: { tenant_id: tenant.id } }),
    });
    await setRazorpayIds(tenant.id, { customerId: customer.id });
    return customer.id;
  } catch {
    return undefined;   // a duplicate-customer 400 or transient error shouldn't block checkout
  }
}

export interface CreatedSubscription { subscriptionId: string; shortUrl: string }

// Creates the subscription in `created` status (not yet paid) and stamps its
// id on the tenant immediately, so the webhook has something to match against
// even before the customer completes the checkout modal.
export async function createSubscription(tenant: Tenant, plan: Plan): Promise<CreatedSubscription> {
  const planId = await getOrCreateRazorpayPlan(plan);
  const customerId = await getOrCreateRazorpayCustomer(tenant);
  const sub = await rzp<{ id: string; short_url: string }>("/subscriptions", {
    method: "POST",
    body: JSON.stringify({
      plan_id: planId, total_count: INDEFINITE_CYCLES, customer_notify: true,
      ...(customerId ? { customer_id: customerId } : {}),
      notes: { tenant_id: tenant.id, plan: plan.key },
    }),
  });
  await setRazorpayIds(tenant.id, { subscriptionId: sub.id });
  return { subscriptionId: sub.id, shortUrl: sub.short_url };
}

export interface RazorpaySubscriptionDetail {
  planKey: string | null; amountCents: number; currency: string; currentPeriodEnd: string | null;
}

// Read back a subscription's actual plan/amount/period from Razorpay itself —
// the authoritative record of what was purchased, rather than trusting
// whatever the client happened to send. Used by the post-checkout verify
// route, which only receives Razorpay's three signature-check fields and has
// no other way to know which plan the customer just bought.
export async function getSubscriptionDetail(subscriptionId: string): Promise<RazorpaySubscriptionDetail> {
  const sub = await rzp<{
    notes?: Record<string, string>; current_end?: number;
    plan?: { item?: { amount?: number; currency?: string }; notes?: Record<string, string> };
  }>(`/subscriptions/${subscriptionId}`);
  return {
    planKey: sub.notes?.plan ?? sub.plan?.notes?.plan_key ?? null,
    amountCents: sub.plan?.item?.amount ?? 0,
    currency: sub.plan?.item?.currency ?? "INR",
    currentPeriodEnd: sub.current_end ? new Date(sub.current_end * 1000).toISOString() : null,
  };
}

// Post-checkout signature check. NOTE the field order: payment_id first, then
// subscription_id — this is the subscription-checkout formula, distinct from
// Standard Checkout's order_id-first formula used elsewhere in this codebase
// (src/app/api/webhooks/razorpay/route.ts verifies a webhook body, not this).
export function verifySubscriptionSignature(paymentId: string, subscriptionId: string, signature: string): boolean {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${paymentId}|${subscriptionId}`).digest("hex");
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  return sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf);
}

// Webhook body verification — same raw-HMAC-over-body shape as the existing
// payment_link.paid webhook, just against RAZORPAY_SUBSCRIPTIONS_WEBHOOK_SECRET
// (a separate secret, since it's configured as a separate webhook endpoint in
// the Razorpay dashboard with its own event subscriptions).
export function verifyRazorpayWebhook(rawBody: string, signature: string, secret: string): boolean {
  if (!secret) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  return sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf);
}
