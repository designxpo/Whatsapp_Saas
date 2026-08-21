import { NextResponse } from "next/server";
import { isPlatformOwner, currentUser } from "@/lib/auth";
import { getAffiliate, listReferredTenants, listCommissions, updateAffiliate } from "@/lib/affiliates";
import { ownerAudit } from "@/lib/tenants";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// GET — one affiliate's full detail for the owner-portal drawer: identity,
// every referred tenant, and the complete commission ledger.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isPlatformOwner())) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  const { id } = await params;
  try {
    const affiliate = await getAffiliate(id);
    if (!affiliate) return NextResponse.json({ error: "Affiliate not found" }, { status: 404 });
    const [referrals, commissions] = await Promise.all([listReferredTenants(id), listCommissions(id)]);
    return NextResponse.json({ affiliate, referrals, commissions });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

// PATCH — edit an affiliate's commission rate and/or status. Only affects
// commission recorded from this point forward; past ledger rows keep the
// rate they were actually earned at.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isPlatformOwner())) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  const { id } = await params;
  let body: { commissionPct?: number; status?: "active" | "suspended" };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  try {
    const affiliate = await updateAffiliate(id, body);
    const actor = (await currentUser())?.email ?? "owner";
    const changes = [
      body.commissionPct !== undefined ? `commission → ${body.commissionPct}%` : null,
      body.status !== undefined ? `status → ${body.status}` : null,
    ].filter(Boolean).join(", ");
    await ownerAudit(actor, "affiliate.update", null, `Affiliate ${affiliate.email}: ${changes}`);
    return NextResponse.json({ success: true, affiliate });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 400 });
  }
}
