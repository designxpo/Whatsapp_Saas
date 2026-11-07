import { NextResponse } from "next/server";
import { isPlatformOwner, currentUser } from "@/lib/auth";
import { rejectPayout, PayoutError } from "@/lib/affiliate-payouts";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// POST { payoutId, reason? }: reject a payout awaiting approval; its commissions are released.
export async function POST(req: Request) {
  if (!(await isPlatformOwner())) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const actor = (await currentUser())?.email ?? "owner";
  const payoutId = body.payoutId;
  if (typeof payoutId !== "string" || !/^[0-9a-f-]{36}$/i.test(payoutId)) return NextResponse.json({ error: "payoutId is required" }, { status: 400 });
  try {
    await rejectPayout(payoutId, actor, typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : undefined);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: err instanceof PayoutError ? 400 : 500 });
  }
}
