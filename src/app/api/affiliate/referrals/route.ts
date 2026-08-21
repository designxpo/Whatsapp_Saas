import { NextResponse } from "next/server";
import { currentAffiliate } from "@/lib/auth";
import { listReferredTenants, listCommissions } from "@/lib/affiliates";

export async function GET() {
  const me = await currentAffiliate();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [referrals, commissions] = await Promise.all([listReferredTenants(me.affiliateId), listCommissions(me.affiliateId)]);
  return NextResponse.json({ referrals, commissions });
}
