// Meta WhatsApp Embedded Signup — per-tenant WABA onboarding.
//
// Flow (Tech Provider app):
//   1. Frontend opens FB.login({ config_id: META_EMBEDDED_SIGNUP_CONFIG_ID,
//      response_type: 'code', override_default_response_type: true }). The
//      WhatsApp Embedded Signup dialog returns an authorization `code`, and a
//      `message` event carries sessionInfo { waba_id, phone_number_id }.
//   2. Frontend POSTs { code, wabaId, phoneNumberId, name } to
//      /api/admin/onboarding/whatsapp.
//   3. This module exchanges the code for a long-lived business token, subscribes
//      our app to the tenant's WABA webhooks, and (best-effort) registers the
//      number. The caller persists the result via saveChannel (token encrypted).
//
// Requires env: META_APP_ID, META_APP_SECRET (separate Tech Provider app).

const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || "v22.0"}`;

export interface ExchangeResult {
  ok: boolean;
  token?: string;
  error?: string;
  /** Meta's own error code / subcode / trace, surfaced so a failure is diagnosable
   *  from the tenant's screen instead of only from a log line nobody can read. */
  diagnostic?: { code?: number; subcode?: number; trace?: string; raw?: string };
}

// Meta answers THREE different problems with one sentence:
//   "Error validating verification code. Please make sure your redirect_uri is
//    identical to the one you used in the OAuth dialog request"
// namely a reused code, an expired code, and a genuine redirect_uri mismatch.
//
// In the FB.login() flow there IS no redirect_uri — we deliberately send none,
// because the JS SDK has no redirect. So passing Meta's wording straight through
// sends the tenant (and whoever they ask) hunting a setting that this flow does
// not use. Say what can actually be wrong here instead.
export function describeOauthError(err: { message?: string; code?: number; error_subcode?: number } | null | undefined): string {
  const msg = err?.message ?? "";
  if (err?.code === 100 && /verification code|redirect_uri/i.test(msg)) {
    return "Facebook wouldn't accept the login code. These codes are single-use and expire within minutes, so this is almost always a code that was already spent or left too long — click Connect with Facebook again and complete the window without pausing. " +
      "If it repeats every time, the app's Facebook Login for Business settings need this site listed under \"Allowed Domains for the JavaScript SDK\" (and app.thetalko.in under App Domains).";
  }
  if (err?.code === 190) return "Facebook rejected the credentials for this app. Check META_APP_ID and META_APP_SECRET.";
  return msg || "Facebook wouldn't complete the connection.";
}

// Exchange the Embedded Signup authorization code for a business access token.
export async function exchangeSignupCode(code: string): Promise<ExchangeResult> {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) return { ok: false, error: "META_APP_ID / META_APP_SECRET not configured" };
  if (!code) return { ok: false, error: "Missing signup code" };

  const url = new URL(`${GRAPH}/oauth/access_token`);
  url.searchParams.set("client_id", appId);
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("code", code);

  try {
    const r = await fetch(url, { method: "GET" });
    const j = await r.json();
    if (!r.ok || !j.access_token) {
      // Meta's message alone is often ambiguous — "Error validating verification
      // code" covers a reused code, an expired one, and a redirect_uri mismatch,
      // which need different fixes. Log the whole error object so the subcode and
      // fbtrace_id are available when only the tenant-facing sentence surfaces.
      console.error("[meta-oauth] code exchange failed", JSON.stringify(j.error ?? { status: r.status }));
      return {
        ok: false,
        error: describeOauthError(j.error) || `Token exchange failed (${r.status})`,
        diagnostic: { code: j.error?.code, subcode: j.error?.error_subcode, trace: j.error?.fbtrace_id, raw: j.error?.message },
      };
    }
    return { ok: true, token: j.access_token as string };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Token exchange error" };
  }
}

// Exchange a short-lived USER token (from plain FB.login) for a long-lived one.
// Page tokens derived from a long-lived user token are themselves long-lived
// (effectively non-expiring), which is what a stored Messenger channel needs.
export async function exchangeForLongLivedToken(shortToken: string): Promise<ExchangeResult> {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) return { ok: false, error: "META_APP_ID / META_APP_SECRET not configured" };
  if (!shortToken) return { ok: false, error: "Missing token" };

  const url = new URL(`${GRAPH}/oauth/access_token`);
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", appId);
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("fb_exchange_token", shortToken);

  try {
    const r = await fetch(url, { method: "GET" });
    const j = await r.json();
    if (!r.ok || !j.access_token) return { ok: false, error: j.error?.message || `Long-lived exchange failed (${r.status})` };
    return { ok: true, token: j.access_token as string };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Long-lived exchange error" };
  }
}

// Subscribe our app to the tenant's WABA so inbound messages hit our webhook.
export async function subscribeWaba(wabaId: string, token: string): Promise<{ ok: boolean; error?: string }> {
  if (!wabaId || !token) return { ok: false, error: "Missing wabaId / token" };
  try {
    const r = await fetch(`${GRAPH}/${wabaId}/subscribed_apps`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const j = await r.json();
    if (!r.ok || j.success === false) return { ok: false, error: j.error?.message || `Subscribe failed (${r.status})` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Subscribe error" };
  }
}

// The Page permission that decides whether comment (`feed`) events are ever
// delivered — the Facebook twin of instagram_business_manage_comments. Named
// here for the same reason: a Page can be subscribed to `feed` without it, so
// the subscription is not proof that anything will arrive.
export const FB_COMMENT_SCOPE = "pages_read_user_content";

/** Where a Page channel's granted scopes are remembered (wa_settings). */
export const fbScopesKey = (channelId: string) => `fb_scopes:${channelId}`;

// What Meta thinks of a Page token, live.
//
// Unlike Instagram-login tokens — which no debug endpoint will accept, forcing
// us to store the grant list captured at connect — a Facebook Page token can be
// inspected at any time. That is strictly better than a stored snapshot: it
// reflects a permission the tenant revoked yesterday, which a snapshot never
// would. Returns null when the probe itself fails, so "couldn't check" is never
// mistaken for "checked and found nothing".
export interface FbTokenInfo {
  valid: boolean;
  type: string | null;          // "PAGE" for a real Page token; "USER" means a wrong token was stored
  expiresAt: number;            // unix seconds; 0 = never expires (what a Page token should be)
  scopes: string[];
  profileId: string | null;     // the Page this token belongs to
  error?: string;
}

export async function fbTokenInfo(token: string): Promise<FbTokenInfo | null> {
  const appId = process.env.META_APP_ID, appSecret = process.env.META_APP_SECRET;
  if (!token || !appId || !appSecret) return null;
  try {
    const u = new URL(`${GRAPH}/debug_token`);
    u.searchParams.set("input_token", token);
    u.searchParams.set("access_token", `${appId}|${appSecret}`);
    const r = await fetch(u, { cache: "no-store" });
    const j = await r.json().catch(() => null) as { data?: Record<string, unknown>; error?: { message?: string } } | null;
    if (!r.ok || !j?.data) return null;
    const d = j.data;
    return {
      valid: d.is_valid === true,
      type: typeof d.type === "string" ? d.type : null,
      expiresAt: typeof d.expires_at === "number" ? d.expires_at : 0,
      scopes: Array.isArray(d.scopes) ? (d.scopes as string[]) : [],
      profileId: d.profile_id != null ? String(d.profile_id) : null,
      error: typeof (d.error as { message?: string })?.message === "string" ? (d.error as { message?: string }).message : undefined,
    };
  } catch { return null; }
}

/** Which webhook fields this Page is subscribed to, for OUR app specifically. */
export async function pageSubscribedFields(pageId: string, pageToken: string): Promise<{ ok: boolean; fields: string[]; error?: string }> {
  if (!pageId || !pageToken) return { ok: false, fields: [], error: "Missing Page id or token" };
  try {
    const r = await fetch(`${GRAPH}/${encodeURIComponent(pageId)}/subscribed_apps?access_token=${encodeURIComponent(pageToken)}`, { cache: "no-store" });
    const j = await r.json().catch(() => null) as { data?: { id?: string; subscribed_fields?: string[] }[]; error?: { message?: string } } | null;
    if (!r.ok) return { ok: false, fields: [], error: j?.error?.message || `HTTP ${r.status}` };
    // Only OUR app's subscription counts — a Page may have several apps on it.
    const mine = (j?.data ?? []).find(a => a.id === process.env.META_APP_ID) ?? (j?.data ?? [])[0];
    return { ok: true, fields: (mine?.subscribed_fields ?? []).map(String) };
  } catch (e) {
    return { ok: false, fields: [], error: e instanceof Error ? e.message : String(e) };
  }
}

// Which Instagram scopes the token was ACTUALLY granted. Graph does not error
// when you ask for a field the token has no permission for — it silently omits
// the field. So a Page whose Instagram account we simply aren't allowed to see
// is byte-identical to a Page with no Instagram account, and the tenant gets
// sent to relink a Page that was never the problem. Returns NULL when the probe
// itself failed — "we couldn't check" must never be mistaken for "we checked and
// nothing was granted", since only the latter justifies blaming our own config.
export async function grantedScopes(token: string): Promise<string[] | null> {
  try {
    const r = await fetch(`${GRAPH}/me/permissions`, { headers: { Authorization: `Bearer ${token}` } });
    const j = await r.json();
    if (!r.ok) return null;
    return ((j.data ?? []) as { permission?: string; status?: string }[])
      .filter(p => p.status === "granted" && p.permission)
      .map(p => p.permission as string)
      .sort();
  } catch { return null; }
}

async function grantedIgScopes(token: string): Promise<string[] | null> {
  const all = await grantedScopes(token);
  return all === null ? null : all.filter(p => p.startsWith("instagram_"));
}

// Meta shows the SAME "connected" success screen whether or not it granted the
// permissions the flow asked for. Until a permission clears App Review it is
// granted only to users holding a role on the app (admin / developer / tester);
// for everyone else Meta shows the consent UI, returns a valid token, and grants
// nothing. That is precisely why a flow can work for the operator's own Meta
// account and fail for every tenant.
//
// Returns the sentence to show, or null when there is nothing to say — either
// something in this family WAS granted, or the probe failed and we refuse to
// guess. Never blames the tenant, because this is never the tenant's to fix.
export function noGrantMessage(scopes: string[] | null, prefix: string, channel: string): string | null {
  if (scopes === null) return null;                               // couldn't check — say nothing
  if (scopes.some(s => s.startsWith(prefix))) return null;        // granted — a different problem
  return `Meta finished the connection but granted no ${channel} permission, so there's nothing we can set up. That's our Meta app's review status or configuration — not something you can change on your side. Please send this message to support; “Add manually” still works meanwhile.`;
}

// Resolve the Instagram business account + Page from a freshly-exchanged token.
// The Instagram Embedded Signup returns only a `code`; we derive the asset ids
// server-side (/me/accounts → page → Instagram account) so the frontend never
// has to ask the tenant for ids.
export async function resolveInstagramAsset(token: string): Promise<{ ok: boolean; igUserId?: string; pageId?: string; error?: string }> {
  if (!token) return { ok: false, error: "Missing token" };
  try {
    const url = new URL(`${GRAPH}/me/accounts`);
    // A Page carries its Instagram account under TWO different fields, and which
    // one is populated depends on how the account was attached:
    //   instagram_business_account — linked through Meta Business settings
    //   connected_instagram_account — connected from the Instagram app itself
    // Reading only the first is why a genuinely-connected account reported back
    // as "no Instagram professional account linked to it".
    url.searchParams.set("fields", "id,name,instagram_business_account{id},connected_instagram_account{id}");
    // Default page size is 25 — a portfolio with more Pages than that could hide
    // the one carrying the Instagram account behind the first page of results.
    url.searchParams.set("limit", "100");
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const j = await r.json();
    if (!r.ok) return { ok: false, error: j.error?.message || `Account lookup failed (${r.status})` };
    type Page = { id: string; name?: string; instagram_business_account?: { id: string }; connected_instagram_account?: { id: string } };
    const pages: Page[] = j.data ?? [];
    const igOf = (p: Page) => p.instagram_business_account?.id || p.connected_instagram_account?.id;
    const withIg = pages.find(igOf);
    if (withIg) return { ok: true, igUserId: igOf(withIg)!, pageId: withIg.id };

    // Three ways this fails, all of which used to read as one message that named
    // the wrong fix at least two thirds of the time.

    // 1. The popup lets you skip the Page step, and skipping it lands here with
    //    ZERO Pages — while Meta still shows its own "connected" success screen.
    if (!pages.length) {
      return { ok: false, error: "Meta didn't share a Facebook Page with us, so we can't find your Instagram account — Talko reaches Instagram through the Page it's linked to. Run Connect again and, on the Page step, tick the Page your Instagram account is linked to instead of skipping it. (No Page at all? Link one in Instagram → Settings → Account type and tools, or use “Add manually”.)" };
    }

    // 2. Pages came back, but the token was never granted an Instagram scope, so
    //    Graph omitted the Instagram fields entirely. NOT the tenant's Page — our
    //    Meta app's Embedded Signup configuration is missing the permission, and
    //    no amount of relinking on their side will change the answer. Say so, and
    //    say whose job it is.
    const scopes = await grantedIgScopes(token);
    if (scopes !== null && scopes.length === 0) {
      return { ok: false, error: "Meta shared your Facebook Page but granted us no Instagram permission, so we can't read the account behind it. This is a setting on our side, not yours — please send this message to support and use “Add manually” meanwhile." };
    }

    // 3. Genuinely no Instagram account on any shared Page.
    const names = pages.map(p => p.name || p.id).slice(0, 3).join(", ");
    return { ok: false, error: `None of the Facebook Pages you shared (${names}${pages.length > 3 ? `, +${pages.length - 3} more` : ""}) has an Instagram professional account linked to it. Link your Instagram account to the Page in Meta Business settings, then run Connect again — or use “Add manually” if you already have the Instagram account id and token.` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Instagram asset lookup error" };
  }
}

// Resolve the Facebook Pages a freshly-exchanged USER token can manage, each with
// its own PAGE access token (which inherits the granted scopes — pages_messaging,
// pages_manage_engagement, etc.). The Messenger "Connect with Facebook" flow lets
// the admin pick one; the Page token is what we store as the channel token so
// public comment replies (POST /{comment}/comments) actually work.
export async function resolveFacebookPages(
  userToken: string,
): Promise<{ ok: boolean; pages?: { id: string; name: string; token: string }[]; error?: string }> {
  if (!userToken) return { ok: false, error: "Missing token" };
  try {
    const url = new URL(`${GRAPH}/me/accounts`);
    url.searchParams.set("fields", "id,name,access_token");
    url.searchParams.set("limit", "100");
    const r = await fetch(url, { headers: { Authorization: `Bearer ${userToken}` } });
    const j = await r.json();
    if (!r.ok) return { ok: false, error: j.error?.message || `Page lookup failed (${r.status})` };
    const pages = ((j.data as { id?: string; name?: string; access_token?: string }[] | undefined) ?? [])
      .filter(p => p.id && p.access_token)
      .map(p => ({ id: p.id as string, name: (p.name as string) || `Page ${p.id}`, token: p.access_token as string }));
    if (!pages.length) return { ok: false, error: "No Facebook Page found on this account — you need a Page you manage, with a role that can read and reply to its messages." };
    return { ok: true, pages };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Page lookup error" };
  }
}

// Ad accounts a freshly-exchanged token can act on. The ads_management /
// ads_read permissions live in Facebook Login for Business (unlike the Instagram
// ones), so a tenant CAN grant their ad account through the popup — there is no
// reason to make them mint a system-user token by hand.
export async function resolveAdAccounts(
  userToken: string,
): Promise<{ ok: boolean; accounts?: { id: string; name: string; currency?: string; status?: number }[]; error?: string }> {
  if (!userToken) return { ok: false, error: "Missing token" };
  try {
    const url = new URL(`${GRAPH}/me/adaccounts`);
    url.searchParams.set("fields", "account_id,name,currency,account_status");
    url.searchParams.set("limit", "200");
    const r = await fetch(url, { headers: { Authorization: `Bearer ${userToken}` } });
    const j = await r.json();
    if (!r.ok) return { ok: false, error: j.error?.message || `Ad account lookup failed (${r.status})` };
    const accounts = ((j.data as { account_id?: string; name?: string; currency?: string; account_status?: number }[] | undefined) ?? [])
      .filter(a => a.account_id)
      .map(a => ({ id: a.account_id as string, name: a.name || `act_${a.account_id}`, currency: a.currency, status: a.account_status }));
    if (!accounts.length) {
      // Same shape as everywhere else: "none shared" and "no permission to see
      // them" are one response from Graph and need opposite fixes.
      const noGrant = noGrantMessage(await grantedScopes(userToken), "ads_", "ads");
      return { ok: false, error: noGrant ?? "Meta shared no ad account with us. Run Connect again and tick the ad account you want Talko to manage." };
    }
    return { ok: true, accounts };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Ad account lookup error" };
  }
}

// Register the phone number on Cloud API (best-effort; some flows pre-register).
export async function registerPhone(phoneNumberId: string, token: string, pin?: string): Promise<{ ok: boolean; error?: string }> {
  if (!phoneNumberId || !token) return { ok: false, error: "Missing phoneNumberId / token" };
  try {
    const r = await fetch(`${GRAPH}/${phoneNumberId}/register`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", pin: pin || "000000" }),
    });
    const j = await r.json();
    if (!r.ok) return { ok: false, error: j.error?.message || `Register failed (${r.status})` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Register error" };
  }
}
