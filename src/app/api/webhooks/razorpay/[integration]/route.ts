import { NextResponse } from "next/server";
import crypto from "crypto";
import { markOrderPaid } from "@/lib/commerce";
import { resolvePaymentWebhook } from "@/lib/integrations";

export const dynamic = "force-dynamic";

// Per-tenant Razorpay payment webhook. The URL carries the tenant's Razorpay
// integration id (/api/webhooks/razorpay/<integrationId>) — the tenant creates a
// webhook in THEIR OWN Razorpay Dashboard (Settings → Webhooks, event
// `payment_link.paid`) pointing here, and pastes the webhook's secret into the
// portal. We verify the HMAC against THAT tenant's stored secret (fail-closed),
// so payment confirmation is correct for every tenant, not just the platform
// account. The platform-account route at /api/webhooks/razorpay still works too.
export async function POST(req: Request, { params }: { params: Promise<{ integration: string }> }) {
  const { integration } = await params;
  const raw = await req.text();
  const sig = req.headers.get("x-razorpay-signature") ?? "";

  const conn = await resolvePaymentWebhook(integration);
  if (!conn || conn.kind !== "razorpay") return NextResponse.json({ error: "webhook not configured" }, { status: 404 });

  // Constant-time HMAC-SHA256 verification over the raw body, keyed by THIS
  // tenant's webhook secret.
  const expected = crypto.createHmac("sha256", conn.webhookSecret).update(raw).digest("hex");
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let event: { event?: string; payload?: Record<string, { entity?: Record<string, unknown> }> };
  try { event = JSON.parse(raw); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }

  try {
    if (event.event === "payment_link.paid") {
      const pl = event.payload?.payment_link?.entity;
      const pay = event.payload?.payment?.entity;
      const linkId = pl?.id as string | undefined;
      if (linkId) {
        await markOrderPaid({
          paymentRef: linkId,                                             // == wa_orders.payment_ref (checkoutCart stored link.id)
          providerPaymentId: (pay?.id as string | undefined) ?? linkId,
          amountPaidCents: typeof pl?.amount_paid === "number" ? (pl.amount_paid as number)
            : typeof pay?.amount === "number" ? (pay.amount as number) : undefined,
          provider: "razorpay",
          expectTenantId: conn.tenantId,   // may only confirm this tenant's orders
        });
      }
    }
  } catch (err) {
    console.error("[razorpay webhook:tenant]", err);   // 200 anyway so Razorpay doesn't storm retries on a transient DB error
  }
  return NextResponse.json({ received: true });
}
