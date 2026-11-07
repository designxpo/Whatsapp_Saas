import { NextResponse } from "next/server";
import { isPlatformOwner, currentUser } from "@/lib/auth";
import { getManualPaymentInstructions, PayoutError } from "@/lib/affiliate-payouts";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// POST { payoutId }: the full UPI ID / bank details (and a UPI pay link) for a
// payout approved in manual mode, so the owner can pay it from their own app.
// POST rather than GET so the details never land in a URL, history or cache.
// Owner only; every view is audited by the library.
export async function POST(req: Request) {
  if (!(await isPlatformOwner())) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const payoutId = body.payoutId;
  if (typeof payoutId !== "string" || !/^[0-9a-f-]{36}$/i.test(payoutId)) return NextResponse.json({ error: "payoutId is required" }, { status: 400 });
  const actor = (await currentUser())?.email ?? "owner";
  try {
    const instructions = await getManualPaymentInstructions(payoutId, actor);
    return NextResponse.json({ instructions }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: err instanceof PayoutError ? 400 : 500 });
  }
}
