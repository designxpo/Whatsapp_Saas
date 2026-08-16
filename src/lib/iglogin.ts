// ── Business Login for Instagram ──────────────────────────────────────────────
// The connect flow for "Instagram API with Instagram Login" — a DIFFERENT Meta
// product from Facebook Login for Business, with its own app id, its own secret,
// its own permission family and its own OAuth endpoints:
//
//                    Facebook Login for Business   Business Login for Instagram
//   authorize        facebook.com/dialog/oauth     instagram.com/oauth/authorize
//   exchange         graph.facebook.com/oauth      api.instagram.com/oauth/access_token
//   app id           META_APP_ID                   META_INSTAGRAM_APP_ID
//   secret           META_APP_SECRET               META_INSTAGRAM_APP_SECRET
//   permissions      instagram_basic, pages_*      instagram_business_*
//   mechanism        FB.login() popup              redirect + callback
//
// This matters because the two are not interchangeable and the failure is
// silent: the Instagram permissions this app holds (instagram_business_basic,
// instagram_business_manage_messages, instagram_business_manage_comments) cannot
// even be SELECTED in a Facebook Login for Business configuration — the picker
// returns "No matching results" — so that flow granted tenants nothing and Meta
// still showed its own success screen.
//
// The runtime has always been on this side of the line: lib/instagram.ts sends
// via graph.instagram.com, and channels.ts resolves + subscribes there too. Only
// onboarding was on the wrong product.

import { createHmac, timingSafeEqual } from "crypto";

const AUTH_HOST = "https://www.instagram.com";
const TOKEN_HOST = "https://api.instagram.com";
const GRAPH = "https://graph.instagram.com";

// The three permissions Meta lists as required for the Instagram API use case.
// Overridable because a scope the app is not approved for makes Instagram reject
// the WHOLE authorize — dropping one must not need a deploy.
export const IG_SCOPES = (process.env.META_INSTAGRAM_SCOPES ||
  "instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments")
  .split(",").map(s => s.trim()).filter(Boolean);

// The permission that decides whether comment webhooks are ever delivered.
// Worth naming: subscribing an account to the `comments` field SUCCEEDS without
// it — /subscribed_apps happily reports ["messages","comments"] — and Meta then
// silently delivers only messages. So the subscription is not evidence, and the
// grant list Meta returns at token exchange is the only honest answer.
export const IG_COMMENT_SCOPE = "instagram_business_manage_comments";

// Where a channel's granted scopes are remembered (wa_settings, per tenant).
export const igScopesKey = (channelId: string) => `ig_scopes:${channelId}`;

export const igAppId = () => (process.env.META_INSTAGRAM_APP_ID || "").trim();
const igAppSecret = () => (process.env.META_INSTAGRAM_APP_SECRET || "").trim();

export function igLoginReady(): boolean {
  return !!igAppId() && !!igAppSecret();
}

/** Which env vars are absent, for a message that names the fix. */
export function igLoginMissing(): string[] {
  return [!igAppId() && "META_INSTAGRAM_APP_ID", !igAppSecret() && "META_INSTAGRAM_APP_SECRET"].filter(Boolean) as string[];
}

// Meta matches the redirect URI EXACTLY against the whitelist, so it must be
// byte-identical between /start and /callback. Deriving it from the incoming
// request keeps preview deployments working; the env var pins it when the app
// sits behind a proxy that rewrites the host.
export function igRedirectUri(requestUrl: string): string {
  const pinned = (process.env.META_INSTAGRAM_REDIRECT_URI || "").trim();
  if (pinned) return pinned.replace(/\/+$/, "");
  return `${new URL(requestUrl).origin}/api/admin/onboarding/instagram/callback`;
}

// ── CSRF state ────────────────────────────────────────────────────────────────
// The callback runs in the admin's own session, so without this an attacker
// could hand a victim admin a callback URL carrying the ATTACKER's code and
// silently bind their Instagram account to the victim's workspace. The state is
// bound to the tenant and expires, and is compared in constant time.
const STATE_TTL_MS = 10 * 60_000;

function stateKey(): string {
  const k = process.env.ADMIN_JWT_SECRET || process.env.SECRET_ENC_KEY || "";
  if (!k) throw new Error("ADMIN_JWT_SECRET (or SECRET_ENC_KEY) is required to sign the Instagram login state");
  return k;
}
const sign = (payload: string) => createHmac("sha256", stateKey()).update(payload).digest("base64url");

export function signState(tenantId: string, nowMs: number): string {
  const payload = `${tenantId}.${nowMs}`;
  return `${Buffer.from(payload).toString("base64url")}.${sign(payload)}`;
}

export function verifyState(state: string, tenantId: string, nowMs: number): { ok: boolean; reason?: string } {
  const parts = (state || "").split(".");
  if (parts.length !== 2) return { ok: false, reason: "malformed" };
  let payload: string;
  try { payload = Buffer.from(parts[0], "base64url").toString("utf8"); } catch { return { ok: false, reason: "malformed" }; }
  const expected = sign(payload);
  const a = Buffer.from(parts[1]);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "bad signature" };
  const [signedTenant, issued] = payload.split(".");
  if (signedTenant !== tenantId) return { ok: false, reason: "wrong workspace" };
  const at = Number(issued);
  if (!Number.isFinite(at) || nowMs - at > STATE_TTL_MS || at - nowMs > 60_000) return { ok: false, reason: "expired" };
  return { ok: true };
}

// ── OAuth ─────────────────────────────────────────────────────────────────────
export function igAuthorizeUrl(redirectUri: string, state: string): string {
  const u = new URL(`${AUTH_HOST}/oauth/authorize`);
  u.searchParams.set("client_id", igAppId());
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", IG_SCOPES.join(","));
  u.searchParams.set("state", state);
  return u.toString();
}

export interface IgTokenResult { ok: boolean; token?: string; userId?: string; permissions?: string[]; error?: string }

/** Authorization code → SHORT-lived Instagram user token (about an hour). */
export async function exchangeIgCode(code: string, redirectUri: string): Promise<IgTokenResult> {
  if (!igLoginReady()) return { ok: false, error: `Instagram login isn't configured — missing ${igLoginMissing().join(" + ")}` };
  try {
    const body = new URLSearchParams({
      client_id: igAppId(),
      client_secret: igAppSecret(),
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      // Instagram appends #_ to the code in the browser fragment; strip it.
      code: code.replace(/#_$/, ""),
    });
    const r = await fetch(`${TOKEN_HOST}/oauth/access_token`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString(),
    });
    const j = await r.json().catch(() => null) as
      { access_token?: string; user_id?: string | number; permissions?: string[] | string; error_message?: string; error?: { message?: string } } | null;
    if (!r.ok || !j?.access_token) {
      return { ok: false, error: j?.error_message || j?.error?.message || `Instagram token exchange failed (${r.status})` };
    }
    const perms = Array.isArray(j.permissions) ? j.permissions
      : typeof j.permissions === "string" ? j.permissions.split(",").map(s => s.trim()).filter(Boolean)
      : undefined;
    return { ok: true, token: j.access_token, userId: j.user_id != null ? String(j.user_id) : undefined, permissions: perms };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Instagram token exchange error" };
  }
}

/**
 * Short-lived → long-lived (60 days). Worth doing even though it is one more
 * round trip: the short token dies within the hour, so storing it would give
 * every tenant a channel that stops working the same afternoon.
 */
export async function igLongLivedToken(shortToken: string): Promise<IgTokenResult> {
  if (!igAppSecret()) return { ok: false, error: "META_INSTAGRAM_APP_SECRET is not set" };
  try {
    const u = new URL(`${GRAPH}/access_token`);
    u.searchParams.set("grant_type", "ig_exchange_token");
    u.searchParams.set("client_secret", igAppSecret());
    u.searchParams.set("access_token", shortToken);
    const r = await fetch(u, { cache: "no-store" });
    const j = await r.json().catch(() => null) as { access_token?: string; error?: { message?: string } } | null;
    if (!r.ok || !j?.access_token) return { ok: false, error: j?.error?.message || `Long-lived exchange failed (${r.status})` };
    return { ok: true, token: j.access_token };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Long-lived exchange error" };
  }
}
