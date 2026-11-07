import { NextResponse } from "next/server";
import { isPlatformOwner, currentUser } from "@/lib/auth";
import { recordManualPayment, PayoutError } from "@/lib/affiliate-payouts";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// POST { payoutId, utr }: the owner paid a manual payout from their own bank/UPI
// app; record the UTR / UPI reference. Marks the payout and its commissions
// paid and emails the affiliate. A reference can settle one payout only.
export async function POST(req: Request) {
  if (!(await isPlatformOwner())) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const payoutId = body.payoutId;
  if (typeof payoutId !== "string" || !/^[0-9a-f-]{36}$/i.test(payoutId)) return NextResponse.json({ error: "payoutId is required" }, { status: 400 });
  const actor = (await currentUser())?.email ?? "owner";
  try {
    await recordManualPayment(payoutId, body.utr, actor);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: err instanceof PayoutError ? 400 : 500 });
  }
}
