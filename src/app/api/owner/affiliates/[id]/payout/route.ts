import { NextResponse } from "next/server";
import { isPlatformOwner, currentUser } from "@/lib/auth";
import { markCommissionsPaid } from "@/lib/affiliates";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// POST — mark a set of pending commission rows as paid (manual payout,
// v1 scope: the owner pays the affiliate off-platform, then records it here).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isPlatformOwner())) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  const { id } = await params;
  let body: { commissionIds?: string[] };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const commissionIds = (body.commissionIds ?? []).filter((v): v is string => typeof v === "string" && !!v);
  if (!commissionIds.length) return NextResponse.json({ error: "commissionIds is required" }, { status: 400 });

  try {
    const actor = (await currentUser())?.email ?? "owner";
    await markCommissionsPaid(id, commissionIds, actor);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
