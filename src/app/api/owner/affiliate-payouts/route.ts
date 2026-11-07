import { NextResponse } from "next/server";
import { isPlatformOwner } from "@/lib/auth";
import { listOwnerPayoutData } from "@/lib/affiliate-payouts";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// GET: payouts, per-affiliate payable/holding/flagged totals and flagged commissions.
// Contains no payout destination beyond kind + last 4 digits.
export async function GET() {
  if (!(await isPlatformOwner())) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  try { return NextResponse.json(await listOwnerPayoutData()); }
  catch (err) { return NextResponse.json({ error: errorMessage(err) }, { status: 500 }); }
}
