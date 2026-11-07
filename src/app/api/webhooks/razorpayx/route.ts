import { NextResponse } from "next/server";
import { verifyRazorpayXWebhook } from "@/lib/razorpayx";
import { handlePayoutWebhook, handleFundAccountValidationWebhook } from "@/lib/affiliate-payouts";

export const dynamic = "force-dynamic";

// RazorpayX webhook: payout.* and fund_account.validation.* events for
// affiliate payouts. Configure in Razorpay Dashboard -> Settings -> Webhooks
// (RazorpayX webhooks) pointing at /api/webhooks/razorpayx, with the same
// secret as RAZORPAYX_WEBHOOK_SECRET. Fails closed without the secret.
export async function POST(req: Request) {
  const raw = await req.text();
  const sig = req.headers.get("x-razorpay-signature") ?? "";
  const secret = process.env.RAZORPAYX_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "webhook not configured" }, { status: 503 });
  if (!verifyRazorpayXWebhook(raw, sig, secret)) return NextResponse.json({ error: "invalid signature" }, { status: 401 });

  let event: { event?: string; payload?: Record<string, unknown> };
  try { event = JSON.parse(raw); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const name = event.event ?? "";

  try {
    if (name.startsWith("payout.")) await handlePayoutWebhook(event as Parameters<typeof handlePayoutWebhook>[0]);
    else if (name.startsWith("fund_account.validation.")) await handleFundAccountValidationWebhook(event as Parameters<typeof handleFundAccountValidationWebhook>[0]);
  } catch (err) {
    // 200 anyway, like the sibling webhook, so a transient error does not cause a retry storm.
    // The state transitions are idempotent, and the owner dashboard shows any payout left in processing.
    console.error(JSON.stringify({ at: "razorpayx.webhook", event: name, error: err instanceof Error ? err.message : String(err) }));
  }
  return NextResponse.json({ received: true });
}
