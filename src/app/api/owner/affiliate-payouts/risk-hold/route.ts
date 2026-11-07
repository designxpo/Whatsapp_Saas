import { NextResponse } from "next/server";
import { isPlatformOwner, currentUser } from "@/lib/auth";
import { ownerSetRiskHold, PayoutError } from "@/lib/affiliate-payouts";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// POST { affiliateId, hold, note? }: hold or release all payouts for an affiliate (audited).
export async function POST(req: Request) {
  if (!(await isPlatformOwner())) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const actor = (await currentUser())?.email ?? "owner";
  const { affiliateId, hold, note } = body;
  if (typeof affiliateId !== "string" || !/^[0-9a-f-]{36}$/i.test(affiliateId) || typeof hold !== "boolean") return NextResponse.json({ error: "affiliateId and hold (boolean) are required" }, { status: 400 });
  try {
    await ownerSetRiskHold(affiliateId, hold, actor, typeof note === "string" ? note : undefined);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: err instanceof PayoutError ? 400 : 500 });
  }
}
