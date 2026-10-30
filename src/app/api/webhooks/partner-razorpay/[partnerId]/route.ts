import { NextResponse } from "next/server";
import { handlePartnerRazorpayWebhook } from "@/lib/partner-billing";

export const dynamic = "force-dynamic";

// A white-label partner's OWN Razorpay account posts here when one of its
// customers pays a payment link. Verified with that partner's webhook secret;
// marks the month paid and lifts an unpaid-customer pause.
export async function POST(req: Request, { params }: { params: Promise<{ partnerId: string }> }) {
  const { partnerId } = await params;
  const raw = await req.text();
  try {
    const r = await handlePartnerRazorpayWebhook(partnerId, raw, req.headers.get("x-razorpay-signature") ?? "");
    return NextResponse.json({ received: r.status === 200 }, { status: r.status });
  } catch (e) {
    console.error("[partner-razorpay webhook]", partnerId, e);
    return NextResponse.json({ received: true });   // 200: Razorpay shouldn't storm retries on a transient DB error
  }
}
