export const maxDuration = 60;
import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { verifyWebhookWith } from "@/lib/stripe";
import { markOrderPaid } from "@/lib/commerce";
import { resolvePaymentWebhook } from "@/lib/integrations";

export const dynamic = "force-dynamic";

// Per-tenant Stripe ORDER webhook. The URL carries the tenant's Stripe
// integration id (/api/webhooks/stripe/<integrationId>). The tenant adds an
// endpoint in THEIR OWN Stripe Dashboard (Developers → Webhooks, event
// `checkout.session.completed`) pointing here and pastes its signing secret
// (whsec_…) into the portal. Signature is verified against that tenant's secret.
//
// This handles ONLY in-chat order pay-links (mode=payment) from the tenant's own
// Stripe account. Platform SaaS-subscription billing stays on the platform route
// (/api/webhooks/stripe) with STRIPE_WEBHOOK_SECRET.
export async function POST(req: Request, { params }: { params: Promise<{ integration: string }> }) {
  const { integration } = await params;
  const raw = await req.text();
  const sig = req.headers.get("stripe-signature") ?? "";

  const conn = await resolvePaymentWebhook(integration);
  if (!conn || conn.kind !== "stripe") return NextResponse.json({ error: "webhook not configured" }, { status: 404 });

  let event: Stripe.Event;
  try {
    event = verifyWebhookWith(raw, sig, conn.webhookSecret);
  } catch (err) {
    return NextResponse.json({ error: `Webhook signature failed: ${err instanceof Error ? err.message : err}` }, { status: 400 });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const s = event.data.object as Stripe.Checkout.Session;
      if (s.mode === "payment" && s.payment_status === "paid") {
        const linkId = typeof s.payment_link === "string" ? s.payment_link : s.payment_link?.id;
        const paymentIntentId = typeof s.payment_intent === "string" ? s.payment_intent : s.payment_intent?.id;
        if (linkId) await markOrderPaid({
          paymentRef: linkId,                                    // == wa_orders.payment_ref (checkoutCart stored the pay-link id)
          providerPaymentId: paymentIntentId ?? linkId,
          amountPaidCents: typeof s.amount_total === "number" ? s.amount_total : undefined,
          provider: "stripe",
          expectTenantId: conn.tenantId,   // may only confirm this tenant's orders
        });
      }
    }
  } catch (err) {
    console.error("[stripe webhook:tenant]", event.type, err);
    // 200 anyway so Stripe doesn't hammer retries on a transient DB hiccup.
  }
  return NextResponse.json({ received: true });
}
