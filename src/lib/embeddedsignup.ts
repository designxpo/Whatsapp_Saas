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
      return { ok: false, error: j.error?.message || `Token exchange failed (${r.status})` };
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
