import { NextResponse } from "next/server";
import { isPlatformOwner, currentUser } from "@/lib/auth";
import { cancelManualPayout, PayoutError } from "@/lib/affiliate-payouts";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// POST { payoutId, reason, confirmation: "NOT PAID" }: an approved manual payout
// that was NOT paid goes back to the queue (its commissions become payable again).
// The confirmation phrase is required because cancelling a payout that was in
// fact paid would let the same commissions be paid twice.
export async function POST(req: Request) {
  if (!(await isPlatformOwner())) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const payoutId = body.payoutId;
  if (typeof payoutId !== "string" || !/^[0-9a-f-]{36}$/i.test(payoutId)) return NextResponse.json({ error: "payoutId is required" }, { status: 400 });
  const actor = (await currentUser())?.email ?? "owner";
  try {
    await cancelManualPayout(payoutId, actor, typeof body.reason === "string" ? body.reason : "", body.confirmation);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: err instanceof PayoutError ? 400 : 500 });
  }
}
