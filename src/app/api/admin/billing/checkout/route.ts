import { NextResponse } from "next/server";
import { requireRoleAdmin, currentTenantId, currentUser, noSession } from "@/lib/auth";
import { getTenant, ownerAudit } from "@/lib/tenants";
import { getPlan } from "@/lib/plans";
import { stripeConfigured, createCheckoutSession, getStripePriceSummary } from "@/lib/stripe";
import { hasAutoRenewAck, AUTO_RENEW_ACK_REQUIRED, autoRenewAckDetail } from "@/lib/billing-consent";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// POST { planKey, autoRenewAck: true, displayedAmountCents } — start a Stripe
// Checkout for a subscription. Admins only.
export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  if (!stripeConfigured()) return NextResponse.json({ error: "Billing isn't enabled yet (STRIPE_SECRET_KEY unset)." }, { status: 503 });
  let body: { planKey?: string; autoRenewAck?: unknown; displayedAmountCents?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.planKey?.trim()) return NextResponse.json({ error: "planKey required" }, { status: 400 });
  // Renewal consent, enforced server-side — see razorpay/checkout/route.ts.
  if (!hasAutoRenewAck(body)) return NextResponse.json({ error: AUTO_RENEW_ACK_REQUIRED, needsAutoRenewAck: true }, { status: 400 });
  try {
    const tid = await currentTenantId();
    if (!tid) return noSession();
    const tenant = await getTenant(tid);
    if (!tenant) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    const plan = await getPlan(body.planKey.trim());
    if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    if (!plan.stripePriceId) return NextResponse.json({ error: `"${plan.name}" isn't purchasable yet — no Stripe price configured.` }, { status: 400 });
    // Stripe charges the Price exactly as set in its dashboard; the page shows
    // that same Price. Refuse if it can't be read, or changed since the page
    // loaded, so nobody reaches a payment page quoting a different number.
    const price = await getStripePriceSummary(plan.stripePriceId);
    if (!price) return NextResponse.json({ error: `"${plan.name}" can't be bought online right now — we couldn't confirm its price. Please contact support.` }, { status: 409 });
    if (typeof body.displayedAmountCents === "number" && body.displayedAmountCents !== price.amountCents) {
      return NextResponse.json({ error: `The price for ${plan.name} has changed. Please refresh the page and confirm again.`, priceChanged: true }, { status: 409 });
    }
    // Stripe returns the user to `${baseUrl}/admin/billing`, a PORTAL path — so
    // this must be the app host, NOT the marketing NEXT_PUBLIC_SITE_URL (which
    // would 404 under the host split). Prefer NEXT_PUBLIC_APP_URL; fall back to
    // the request origin (already the app host, since this API is called there).
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
    const actor = (await currentUser())?.email ?? "tenant";
    // What they agreed to, in the words they saw, with the time.
    await ownerAudit(actor, "billing.auto_renew_ack", tid, autoRenewAckDetail({
      planKey: plan.key, provider: "stripe", amountCents: price.amountCents, currency: price.currency, interval: price.interval, intervalCount: price.intervalCount,
    }));
    const url = await createCheckoutSession(tenant, plan, baseUrl);
    await ownerAudit(actor, "billing.checkout", tid, plan.key);
    return NextResponse.json({ url });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
