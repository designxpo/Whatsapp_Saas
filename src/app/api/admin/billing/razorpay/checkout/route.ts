import { NextResponse } from "next/server";
import { requireRoleAdmin, currentTenantId, currentUser, noSession } from "@/lib/auth";
import { getTenant, ownerAudit, hasBillingIdentity } from "@/lib/tenants";
import { getPlan } from "@/lib/plans";
import { razorpayConfigured, createSubscription, resolveRazorpayPlan, RAZORPAY_INTERVAL } from "@/lib/razorpay";
import { computeChargeBreakdown } from "@/lib/billing-tax";
import { hasAutoRenewAck, AUTO_RENEW_ACK_REQUIRED, autoRenewAckDetail } from "@/lib/billing-consent";
import { hasLiveSubscription } from "@/lib/billing-cancel";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

const rupees = (c: number) => `₹${(c / 100).toLocaleString("en-IN")}`;

// POST { planKey, autoRenewAck: true, displayedAmountCents } — start a Razorpay
// Subscription. Admins only. Mirrors billing/checkout/route.ts's Stripe
// equivalent, but returns the raw subscription id + publishable key id for the
// frontend to open Razorpay's checkout.js MODAL, rather than a redirect URL —
// Razorpay subscription checkout is client-side, not hosted.
export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  if (!razorpayConfigured()) return NextResponse.json({ error: "Billing isn't enabled yet (RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET unset)." }, { status: 503 });
  let body: { planKey?: string; autoRenewAck?: unknown; displayedAmountCents?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.planKey?.trim()) return NextResponse.json({ error: "planKey required" }, { status: 400 });
  // The renewal consent is enforced here, not only by the page's checkbox — a
  // direct POST or a tab open from before the checkbox existed must not be
  // able to start a recurring charge nobody agreed to.
  if (!hasAutoRenewAck(body)) return NextResponse.json({ error: AUTO_RENEW_ACK_REQUIRED, needsAutoRenewAck: true }, { status: 400 });

  try {
    const tid = await currentTenantId();
    if (!tid) return noSession();
    const tenant = await getTenant(tid);
    if (!tenant) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });

    // Enforced HERE, not only in the billing page's form. The charge is the
    // point at which we become obliged to issue a document naming the recipient
    // and their place of supply, and the state code is what decides whether the
    // tax is IGST or CGST+SGST — collecting it afterwards means an invoice that
    // cannot be completed. A client-side gate alone would be bypassed by a
    // direct POST or a tab left open from before the form existed.
    if (!hasBillingIdentity(tenant)) {
      return NextResponse.json({ error: "Add your GST billing details before subscribing — we need them to issue a valid invoice for this payment.", needsBillingDetails: true }, { status: 400 });
    }

    // A new checkout creates a SECOND Razorpay subscription; it doesn't replace
    // the first. With one still live, the customer would be billed twice — and
    // because this overwrites the tenant's subscription id, the old one's
    // renewals would no longer even be matched to the workspace.
    if (tenant.paymentProvider === "razorpay" && hasLiveSubscription(tenant)) {
      const until = tenant.currentPeriodEnd ? ` (paid until ${new Date(tenant.currentPeriodEnd).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })})` : "";
      return NextResponse.json({ error: `You already have an active subscription${until}. Starting another here would bill you twice — contact support to switch plans, or choose a new plan after your current one ends.` }, { status: 409 });
    }

    const plan = await getPlan(body.planKey.trim());
    if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });

    // The amount Razorpay will charge must be the amount the card showed. A
    // cached Razorpay Plan keeps whatever price it was created at, so read it
    // back and refuse — before any subscription exists — if it has drifted.
    const shown = computeChargeBreakdown(plan.priceCents).totalChargedCents;
    const rp = await resolveRazorpayPlan(plan);
    if (rp.amountCents !== shown || rp.period !== "monthly" || rp.interval !== 1) {
      console.error(JSON.stringify({ at: "billing.razorpay.checkout.priceMismatch", plan: plan.key, razorpayPlanId: rp.planId, razorpayAmount: rp.amountCents, period: rp.period, interval: rp.interval, shown }));
      return NextResponse.json({ error: `This plan's checkout price doesn't match the ${rupees(shown)}/month shown, so we've stopped before charging anything. Please contact support.` }, { status: 409 });
    }
    if (typeof body.displayedAmountCents === "number" && body.displayedAmountCents !== rp.amountCents) {
      return NextResponse.json({ error: `The price for ${plan.name} is now ${rupees(rp.amountCents)}/month. Please refresh the page and confirm again.`, priceChanged: true }, { status: 409 });
    }

    const actor = (await currentUser())?.email ?? "tenant";
    // What they agreed to, in the words they saw, with the time.
    await ownerAudit(actor, "billing.auto_renew_ack", tid, autoRenewAckDetail({
      planKey: plan.key, provider: "razorpay", amountCents: rp.amountCents, currency: rp.currency, interval: RAZORPAY_INTERVAL,
    }));
    const { subscriptionId } = await createSubscription(tenant, plan, rp.planId);
    await ownerAudit(actor, "billing.razorpay_checkout", tid, plan.key);
    return NextResponse.json({ subscriptionId, razorpayKeyId: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID, amountCents: rp.amountCents, currency: rp.currency });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
