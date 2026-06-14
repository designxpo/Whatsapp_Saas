import { NextResponse } from "next/server";
import { listCampaigns } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ campaigns: await listCampaigns() });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
