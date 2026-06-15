import { NextResponse } from "next/server";
import { listCampaigns } from "@/lib/store";
import { currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    return NextResponse.json({ campaigns: await listCampaigns(tid) });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
