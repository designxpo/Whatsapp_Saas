import { NextResponse } from "next/server";
import { requireRoleAdmin, currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { getTenant, applySubscription } from "@/lib/tenants";
import { verifySubscriptionSignature, getSubscriptionDetail } from "@/lib/razorpay";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// POST { razorpay_payment_id, razorpay_subscription_id, razorpay_signature } —
// called from checkout.js's `handler` once the customer completes payment.
// This is the immediate UI-facing confirmation; the subscription webhook
// remains the durable source of truth for every subsequent renewal (mirrors
// how Stripe's checkout.session.completed only sets ids while
// customer.subscription.* events do the real status sync).
export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  let body: { razorpay_payment_id?: string; razorpay_subscription_id?: string; razorpay_signature?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { razorpay_payment_id: paymentId, razorpay_subscription_id: subscriptionId, razorpay_signature: signature } = body;
  if (!paymentId || !subscriptionId || !signature) return NextResponse.json({ error: "Missing payment fields" }, { status: 400 });

  if (!verifySubscriptionSignature(paymentId, subscriptionId, signature)) {
    return NextResponse.json({ error: "Payment could not be verified" }, { status: 400 });
  }

  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    const tenant = await getTenant(tid);
    if (!tenant) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    // Only proceed if this is actually the subscription we created for this
    // tenant — a signature can be valid yet belong to a different tenant's
    // subscription id if the client sent the wrong one.
    if (tenant.razorpaySubscriptionId !== subscriptionId) {
      return NextResponse.json({ error: "Subscription does not belong to this account" }, { status: 400 });
    }
    // Read the plan/amount back from Razorpay itself — the client only sends
    // the three signature-check fields, so this is the authoritative source
    // for what was actually purchased (not something the client could spoof).
    const detail = await getSubscriptionDetail(subscriptionId);
    await applySubscription(tid, {
      paymentStatus: "active", status: "active", subscriptionId, provider: "razorpay",
      plan: detail.planKey ?? undefined, amountCents: detail.amountCents, currency: detail.currency,
      currentPeriodEnd: detail.currentPeriodEnd,
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
