import { NextResponse } from "next/server";
import { isPlatformOwner, currentUser } from "@/lib/auth";
import { markCommissionsPaid } from "@/lib/affiliates";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// POST — mark a set of pending commission rows as paid (manual payout,
// emergency tool: the owner paid off-platform, then records it here). Refuses
// flagged / in-hold / already-in-a-payout commissions unless manualOverride is
// true with a reason; every call, and every override, is audited. Normal
// payouts go through /api/owner/affiliate-payouts.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isPlatformOwner())) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  const { id } = await params;
  let body: { commissionIds?: string[]; manualOverride?: boolean; reason?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const commissionIds = (body.commissionIds ?? []).filter((v): v is string => typeof v === "string" && !!v);
  if (!commissionIds.length) return NextResponse.json({ error: "commissionIds is required" }, { status: 400 });

  try {
    const actor = (await currentUser())?.email ?? "owner";
    await markCommissionsPaid(id, commissionIds, actor, { manualOverride: body.manualOverride === true, reason: typeof body.reason === "string" ? body.reason : undefined });
    return NextResponse.json({ success: true });
  } catch (err) {
    const refused = err instanceof Error && /^(Refused|A reason is required|Some commissions)/.test(err.message);
    return NextResponse.json({ error: errorMessage(err) }, { status: refused ? 409 : 500 });
  }
}
