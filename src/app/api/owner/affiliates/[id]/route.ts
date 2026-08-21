import { NextResponse } from "next/server";
import { isPlatformOwner } from "@/lib/auth";
import { getAffiliate, listReferredTenants, listCommissions } from "@/lib/affiliates";
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
