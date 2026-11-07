import { NextResponse } from "next/server";
import { isPlatformOwner, currentUser } from "@/lib/auth";
import { approvePayout, PayoutError } from "@/lib/affiliate-payouts";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// POST { payoutId }: approve and send a payout. Re-checks every cap and the affiliate's current state.
export async function POST(req: Request) {
  if (!(await isPlatformOwner())) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const actor = (await currentUser())?.email ?? "owner";
  const payoutId = body.payoutId;
  if (typeof payoutId !== "string" || !/^[0-9a-f-]{36}$/i.test(payoutId)) return NextResponse.json({ error: "payoutId is required" }, { status: 400 });
  try {
    const r = await approvePayout(payoutId, actor);
    return NextResponse.json({ success: true, status: r.status });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: err instanceof PayoutError ? 400 : 500 });
  }
}
