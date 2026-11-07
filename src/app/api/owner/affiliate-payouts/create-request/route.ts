import { NextResponse } from "next/server";
import { isPlatformOwner, currentUser } from "@/lib/auth";
import { createPayoutRequest, PayoutError } from "@/lib/affiliate-payouts";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// POST { affiliateId }: bundle the affiliate's payable commissions into an awaiting-approval payout.
export async function POST(req: Request) {
  if (!(await isPlatformOwner())) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const actor = (await currentUser())?.email ?? "owner";
  const affiliateId = body.affiliateId;
  if (typeof affiliateId !== "string" || !/^[0-9a-f-]{36}$/i.test(affiliateId)) return NextResponse.json({ error: "affiliateId is required" }, { status: 400 });
  try {
    const payoutId = await createPayoutRequest(affiliateId, actor);
    if (!payoutId) return NextResponse.json({ success: false, payoutId: null, message: "Nothing payable: below the minimum, still inside the hold, flagged, or the payout account is not eligible." });
    return NextResponse.json({ success: true, payoutId });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: err instanceof PayoutError ? 400 : 500 });
  }
}
