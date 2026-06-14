import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { listAdSets, listAds, type DatePreset } from "@/lib/ads";

export const dynamic = "force-dynamic";

// GET ?campaignId=&preset= — ad sets + ads inside one campaign, with insights.
export async function GET(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const campaignId = url.searchParams.get("campaignId");
  const presetRaw = url.searchParams.get("preset") ?? "last_7d";
  const preset: DatePreset = presetRaw === "today" || presetRaw === "last_30d" ? presetRaw : "last_7d";
  if (!campaignId) return NextResponse.json({ error: "campaignId required" }, { status: 400 });

  const [sets, ads] = await Promise.all([listAdSets(campaignId, preset), listAds(campaignId, preset)]);
  return NextResponse.json({ adsets: sets.adsets, ads: ads.ads, error: sets.error ?? ads.error ?? null });
}
