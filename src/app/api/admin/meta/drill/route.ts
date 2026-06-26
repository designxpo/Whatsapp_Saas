import { NextResponse } from "next/server";
import { requireAdmin, currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { listAdSets, listAds, getAdsAccountId, getAccountTimezone, type DatePreset } from "@/lib/ads";

export const dynamic = "force-dynamic";

// GET ?campaignId=&preset= — ad sets + ads inside one campaign, with insights.
export async function GET(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const campaignId = url.searchParams.get("campaignId");
  const presetRaw = url.searchParams.get("preset") ?? "last_7d";
  const preset: DatePreset = presetRaw === "today" || presetRaw === "last_30d" ? presetRaw : "last_7d";
  if (!campaignId) return NextResponse.json({ error: "campaignId required" }, { status: 400 });

  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  const tz = await getAccountTimezone(await getAdsAccountId(tid)).catch(() => undefined);
  const [sets, ads] = await Promise.all([listAdSets(campaignId, preset, tz), listAds(campaignId, preset, tz)]);
  return NextResponse.json({ adsets: sets.adsets, ads: ads.ads, error: sets.error ?? ads.error ?? null });
}
