import { NextResponse } from "next/server";
import { listCampaigns } from "@/lib/store";
import { currentTenantId, noSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const tid = await currentTenantId();
    if (!tid) return noSession();
    return NextResponse.json({ campaigns: await listCampaigns(tid) });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
