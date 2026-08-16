import { NextResponse } from "next/server";
import { requireRoleAdmin, currentUser, currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { exchangeSignupCode, exchangeForLongLivedToken, resolveAdAccounts } from "@/lib/embeddedsignup";
import { setAdsToken, setAdsAccountId, getAdAccount } from "@/lib/ads";
import { logActivity } from "@/lib/team";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TAG = "[ads-onboarding]";

// POST { code, accountId?, pageId? } — connect Meta Ads through Facebook Login
// for Business, the same one-click path WhatsApp and Messenger already use.
//
// Asking a tenant to mint a system-user token by hand was never right: ads_read
// and ads_management ARE Facebook Login permissions (unlike the instagram_business_*
// family), so a Login-for-Business configuration carrying the Ad account asset
// type lets the tenant grant their account in the popup. The manual paste stays
// as the fallback for a tenant whose ad account sits outside the portfolio they
// log in with.
export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tenantId = (await currentTenantId()) ?? DEFAULT_TENANT_ID;

  let body: { code?: string; accountId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.code) return NextResponse.json({ error: "Missing signup code" }, { status: 400 });

  const ex = await exchangeSignupCode(body.code);
  if (!ex.ok || !ex.token) {
    console.error(TAG, "token exchange failed", { tenantId, error: ex.error });
    return NextResponse.json({ error: ex.error || "Token exchange failed" }, { status: 502 });
  }
  // A system-user token is already non-expiring and this is a no-op for it; a
  // plain user token would otherwise die in about an hour and take the tenant's
  // ads dashboard with it. Best-effort either way — never fail the connect over it.
  const long = await exchangeForLongLivedToken(ex.token).catch(() => ({ ok: false } as const));
  const token = ("token" in long && long.ok && long.token) ? long.token : ex.token;

  const res = await resolveAdAccounts(token);
  if (!res.ok || !res.accounts?.length) {
    console.error(TAG, "ad account resolve failed", { tenantId, error: res.error });
    return NextResponse.json({ error: res.error || "No ad account found" }, { status: 502 });
  }

  // The one they picked, or the only one — otherwise ask, and they re-run the
  // login for a fresh code (a Login-for-Business code is single-use).
  const wanted = (body.accountId ?? "").replace(/^act_/, "").trim();
  const chosen = wanted ? res.accounts.find(a => a.id === wanted) : (res.accounts.length === 1 ? res.accounts[0] : null);
  if (!chosen) {
    return NextResponse.json({ needsAccountChoice: true, accounts: res.accounts.map(a => ({ id: a.id, name: a.name, currency: a.currency })) });
  }

  await setAdsToken(token, tenantId);
  await setAdsAccountId(chosen.id, tenantId);
  logActivity(await currentUser(), "ads.connect", `act_${chosen.id} via Facebook login`);

  // Prove it before claiming success — the whole point of this route is that the
  // tenant should never again be told "saved" by us and "denied" by Meta.
  const acct = await getAdAccount(chosen.id, tenantId);
  console.log(TAG, "connected", { tenantId, accountId: chosen.id, live: acct.ok, error: acct.error });
  return NextResponse.json({
    success: true, connected: acct.ok,
    accountId: chosen.id, account: acct.account ?? null,
    error: acct.ok ? null : acct.error,
  });
}
