import { NextResponse } from "next/server";
import crypto from "crypto";
import { markOrderPaid } from "@/lib/commerce";

export const dynamic = "force-dynamic";

// Razorpay payment webhook — confirms an in-chat order when its hosted pay link
// is paid. Configure in Razorpay Dashboard → Settings → Webhooks with the
// `payment_link.paid` event pointing at /api/webhooks/razorpay, and set the same
// secret as RAZORPAY_WEBHOOK_SECRET. Signature is verified fail-closed (no secret
// → 503). Reconciliation + exactly-once fulfilment live in markOrderPaid().
export async function POST(req: Request) {
  const raw = await req.text();
  const sig = req.headers.get("x-razorpay-signature") ?? "";
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "webhook not configured" }, { status: 503 });

  // Constant-time HMAC-SHA256 verification over the raw body.
  const expected = crypto.createHmac("sha256", secret).update(raw).digest("hex");
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
        });
      }
    }
    // Other events (payment.captured, refund, etc.) are ignored for now.
  } catch (err) {
    console.error("[razorpay webhook]", err);   // 200 anyway so Razorpay doesn't storm retries on a transient DB error
  }
  return NextResponse.json({ received: true });
}
