import { NextResponse } from "next/server";
import { isPlatformOwner, currentUser } from "@/lib/auth";
import { ownerVerifyPayoutAccount, PayoutError } from "@/lib/affiliate-payouts";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// POST { affiliateId, note }: owner vouches for a payout account whose penny-test needed review (audited). The 7-day cooldown still applies.
export async function POST(req: Request) {
  if (!(await isPlatformOwner())) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const actor = (await currentUser())?.email ?? "owner";
  const { affiliateId, note } = body;
  if (typeof affiliateId !== "string" || !/^[0-9a-f-]{36}$/i.test(affiliateId)) return NextResponse.json({ error: "affiliateId is required" }, { status: 400 });
  try {
    await ownerVerifyPayoutAccount(affiliateId, actor, typeof note === "string" ? note : "");
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: err instanceof PayoutError ? 400 : 500 });
  }
}
