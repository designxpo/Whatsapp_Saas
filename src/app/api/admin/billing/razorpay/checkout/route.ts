import { NextResponse } from "next/server";
import { requireRoleAdmin, currentTenantId, currentUser, DEFAULT_TENANT_ID } from "@/lib/auth";
import { getTenant, ownerAudit, hasBillingIdentity } from "@/lib/tenants";
import { getPlan } from "@/lib/plans";
import { razorpayConfigured, createSubscription } from "@/lib/razorpay";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// POST { planKey } — start a Razorpay Subscription. Admins only. Mirrors
// billing/checkout/route.ts's Stripe equivalent, but returns the raw
// subscription id + publishable key id for the frontend to open Razorpay's
// checkout.js MODAL, rather than a redirect URL — Razorpay subscription
// checkout is client-side, not hosted.
export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  if (!razorpayConfigured()) return NextResponse.json({ error: "Billing isn't enabled yet (RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET unset)." }, { status: 503 });
  let body: { planKey?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.planKey?.trim()) return NextResponse.json({ error: "planKey required" }, { status: 400 });

  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
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

    const plan = await getPlan(body.planKey.trim());
    if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });

    const { subscriptionId } = await createSubscription(tenant, plan);
    await ownerAudit((await currentUser())?.email ?? "tenant", "billing.razorpay_checkout", tid, plan.key);
    return NextResponse.json({ subscriptionId, razorpayKeyId: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
