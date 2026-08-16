import { NextResponse } from "next/server";
import { requireAdmin, requireRoleAdmin, currentUser, currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { getAdsAccountId, setAdsAccountId, getAdsPageId, setAdsPageId, setAdsToken, getAdsTokenStatus, getAdAccount, listAdCampaigns, adAttribution, type DatePreset } from "@/lib/ads";
import { listPortalCampaignIds } from "@/lib/adsmeta";
import { logActivity } from "@/lib/team";

export const dynamic = "force-dynamic";

// GET ?preset=today|last_7d|last_30d — connection status, account, campaigns
// with insights, and CTWA lead attribution from our own contacts.
export async function GET(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const presetRaw = new URL(req.url).searchParams.get("preset") ?? "last_7d";
  const preset: DatePreset = presetRaw === "today" || presetRaw === "last_30d" ? presetRaw : "last_7d";

  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  const [accountId, pageId, token] = await Promise.all([getAdsAccountId(tid), getAdsPageId(tid), getAdsTokenStatus(tid)]);
  if (!accountId) return NextResponse.json({ connected: false, accountId: "", pageId, token });

  // Fetch the account first so we know its reporting timezone, then anchor the
  // campaign insight windows to it (so "today" is included and matches the account).
  const acct = await getAdAccount(accountId, tid);
  const tz = acct.account?.timezoneName;
  const [camps, attribution, portalIds] = await Promise.all([
    listAdCampaigns(accountId, preset, tz, tid),
    adAttribution(tid).catch(() => []),
    listPortalCampaignIds(tid).catch(() => []),
  ]);

  return NextResponse.json({
    connected: acct.ok,
    accountId,
    pageId,
    token,
    account: acct.account ?? null,
    error: acct.ok ? (camps.ok ? null : camps.error) : acct.error,
    campaigns: camps.campaigns,
    attribution,
    portalCampaignIds: portalIds,
  });
}

// POST { accountId?, pageId?, token? } — save the ad account / Page / access token
// for THIS workspace (admins only). The token is the piece that used to be
// missing: the ad account was per-tenant but the token was one shared env var,
// so Meta rejected every tenant whose account the platform token had no role on.
export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  let body: { accountId?: string; pageId?: string; token?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;

  if (body.token !== undefined) {
    const tok = body.token.trim();
    // A Meta token is a long opaque string; catching an obviously-wrong paste
    // here beats a (#190) from Graph three screens later.
    if (tok && tok.length < 40) return NextResponse.json({ error: "That doesn't look like a Meta access token — copy the whole string from Business settings → System users → Generate new token." }, { status: 400 });
    await setAdsToken(tok, tid);
    // Never log the token itself, only that one was set.
    logActivity(await currentUser(), "ads.token", tok ? "saved" : "cleared");
    if (body.accountId === undefined && body.pageId === undefined) {
      const savedId = await getAdsAccountId(tid);
      if (!savedId) return NextResponse.json({ success: true, connected: false });
      const acct = await getAdAccount(savedId, tid);
      return NextResponse.json({ success: true, connected: acct.ok, account: acct.account ?? null, error: acct.error ?? null });
    }
  }

  if (body.pageId !== undefined) {
    const pid = body.pageId.trim();
    if (pid && !/^\d{5,}$/.test(pid)) return NextResponse.json({ error: "Enter the numeric Facebook Page ID" }, { status: 400 });
    await setAdsPageId(pid, tid);
    logActivity(await currentUser(), "ads.connect", `page ${pid || "(cleared)"}`);
    if (body.accountId === undefined) return NextResponse.json({ success: true });
  }

  const id = (body.accountId ?? "").replace(/^act_/, "").trim();
  if (!/^\d{5,}$/.test(id)) return NextResponse.json({ error: "Enter the numeric ad account ID (the number after act_ in Ads Manager's URL)" }, { status: 400 });
  await setAdsAccountId(id, tid);
  logActivity(await currentUser(), "ads.connect", id);
  const acct = await getAdAccount(id, tid);
  return NextResponse.json({ success: true, connected: acct.ok, account: acct.account ?? null, error: acct.error ?? null });
}
