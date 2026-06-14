import { NextResponse } from "next/server";
import { requireAdmin, requireRoleAdmin, currentUser } from "@/lib/auth";
import { getAdsAccountId, setAdsAccountId, getAdsPageId, setAdsPageId, getAdAccount, listAdCampaigns, adAttribution, type DatePreset } from "@/lib/ads";
import { listPortalCampaignIds } from "@/lib/adsmeta";
import { logActivity } from "@/lib/team";

export const dynamic = "force-dynamic";

// GET ?preset=today|last_7d|last_30d — connection status, account, campaigns
// with insights, and CTWA lead attribution from our own contacts.
export async function GET(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const presetRaw = new URL(req.url).searchParams.get("preset") ?? "last_7d";
  const preset: DatePreset = presetRaw === "today" || presetRaw === "last_30d" ? presetRaw : "last_7d";

  const [accountId, pageId] = await Promise.all([getAdsAccountId(), getAdsPageId()]);
  if (!accountId) return NextResponse.json({ connected: false, accountId: "", pageId });

  const [acct, camps, attribution, portalIds] = await Promise.all([
    getAdAccount(accountId),
    listAdCampaigns(accountId, preset),
    adAttribution().catch(() => []),
    listPortalCampaignIds().catch(() => []),
  ]);

  return NextResponse.json({
    connected: acct.ok,
    accountId,
    pageId,
    account: acct.account ?? null,
    error: acct.ok ? (camps.ok ? null : camps.error) : acct.error,
    campaigns: camps.campaigns,
    attribution,
    portalCampaignIds: portalIds,
  });
}

// POST { accountId?, pageId? } — save the ad account / Page connection (admins only).
export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  let body: { accountId?: string; pageId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (body.pageId !== undefined) {
    const pid = body.pageId.trim();
    if (pid && !/^\d{5,}$/.test(pid)) return NextResponse.json({ error: "Enter the numeric Facebook Page ID" }, { status: 400 });
    await setAdsPageId(pid);
    logActivity(await currentUser(), "ads.connect", `page ${pid || "(cleared)"}`);
    if (body.accountId === undefined) return NextResponse.json({ success: true });
  }

  const id = (body.accountId ?? "").replace(/^act_/, "").trim();
  if (!/^\d{5,}$/.test(id)) return NextResponse.json({ error: "Enter the numeric ad account ID (the number after act_ in Ads Manager's URL)" }, { status: 400 });
  await setAdsAccountId(id);
  logActivity(await currentUser(), "ads.connect", id);
  const acct = await getAdAccount(id);
  return NextResponse.json({ success: true, connected: acct.ok, account: acct.account ?? null, error: acct.error ?? null });
}
