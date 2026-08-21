import { NextResponse } from "next/server";
import { currentAffiliate } from "@/lib/auth";
import { affiliateOwnStats } from "@/lib/affiliates";

export async function GET() {
  const me = await currentAffiliate();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const stats = await affiliateOwnStats(me.affiliateId);
  if (!stats) return NextResponse.json({ error: "Affiliate account not found" }, { status: 404 });
  return NextResponse.json({ stats });
}
