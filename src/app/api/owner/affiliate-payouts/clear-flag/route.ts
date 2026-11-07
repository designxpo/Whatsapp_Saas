import { NextResponse } from "next/server";
import { isPlatformOwner, currentUser } from "@/lib/auth";
import { ownerClearFlag, PayoutError } from "@/lib/affiliate-payouts";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// POST { commissionId, note }: clear a flagged commission after review (audited).
export async function POST(req: Request) {
  if (!(await isPlatformOwner())) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const actor = (await currentUser())?.email ?? "owner";
  const { commissionId, note } = body;
  if (typeof commissionId !== "string" || !/^[0-9a-f-]{36}$/i.test(commissionId)) return NextResponse.json({ error: "commissionId is required" }, { status: 400 });
  try {
    await ownerClearFlag(commissionId, actor, typeof note === "string" ? note : "");
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: err instanceof PayoutError ? 400 : 500 });
  }
}
