// Google Business Profile client — Reviews module (Phase 2).
//
// Three DIFFERENT Google API generations are involved, because Google split up
// the old "Google My Business API" over the years:
//   - Account Management API  (mybusinessaccountmanagement) — list accounts.
//   - Business Information API (mybusinessbusinessinformation) — list locations.
//   - The legacy v4 "My Business API" (mybusiness.googleapis.com/v4) — reviews
//     list/reply/delete-reply. This is the ONE Google still gates behind a
//     separate access request (the "Business Profile APIs" form) — an approved
//     OAuth client can still get 403s here until that's granted.
// Account/location discovery and replies return their error as data. Listing
// reviews THROWS a GoogleReviewsError instead: returning [] there made lost
// access look exactly like "no reviews yet", so imports could stop and nothing
// said why. The poller records the error per connection; the Reviews tab
// shows it.
//
// Auth: reuses the SAME Google OAuth client as YouTube (youtube.ts) — one
// Google Cloud project, two scopes. A per-channel OAuth refresh token (stored
// encrypted in wa_channels.access_token) is exchanged for a short-lived access
// token at call time.

import { moderateText } from "./moderation";

const ACCOUNTS_API = "https://mybusinessaccountmanagement.googleapis.com/v1";
const INFO_API = "https://mybusinessbusinessinformation.googleapis.com/v1";
const REVIEWS_API = "https://mybusiness.googleapis.com/v4";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVIEWS_SCOPE = "https://www.googleapis.com/auth/business.manage";

export interface GrCreds {
  channelId: string;       // wa_channels.id — cache key for the access-token exchange
  refreshToken: string;
  accountId?: string | null;   // e.g. "accounts/12345" — required for locations/reviews calls
  locationId?: string | null;  // e.g. "locations/6789"
}

export function googleReviewsConfigured(): boolean {
  return !!(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET);
}

// ── Access-token exchange (refresh-token grant) — same mechanics as youtube.ts,
// separate cache so the two scopes' tokens never collide.
const tokenCache = new Map<string, { token: string; expiresAt: number }>();
async function accessTokenFor(creds: GrCreds): Promise<string | null> {
  if (!googleReviewsConfigured() || !creds.refreshToken) return null;
  const cached = tokenCache.get(creds.channelId);
  if (cached && cached.expiresAt - 60_000 > Date.now()) return cached.token;
  try {
    const body = new URLSearchParams({
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID as string,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET as string,
      refresh_token: creds.refreshToken,
      grant_type: "refresh_token",
    });
    const r = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
    const j = (await r.json().catch(() => null)) as { access_token?: string; expires_in?: number } | null;
    if (!r.ok || !j?.access_token) return null;
    const expiresAt = Date.now() + (j.expires_in ?? 3600) * 1000;
    tokenCache.set(creds.channelId, { token: j.access_token, expiresAt });
    return j.access_token;
  } catch { return null; }
}

// Keeps Google's error instead of collapsing every failure to null. Without
// this, "this Google account manages no Business Profile" is indistinguishable
// from "the API isn't enabled" or "the access request isn't approved" — the
// three very different reasons the location picker can come back empty.
async function apiGetDetailed(token: string, url: string): Promise<{ data: Record<string, unknown> | null; error?: string }> {
  try {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const j = (await r.json().catch(() => null)) as Record<string, unknown> | null;
    if (r.ok) return { data: j };
    const err = j?.error as { message?: string; status?: string } | undefined;
    const msg = err?.message ?? "";
    if (err?.status === "PERMISSION_DENIED" || r.status === 403) {
      // Google uses SERVICE_DISABLED when the API isn't switched on for the
      // project. Talko's Business Profile API access is approved (3 Nov 2026),
      // so a plain denial now means this Google login can't manage the profile.
      if (/SERVICE_DISABLED|has not been used in project|is disabled/i.test(msg)) {
        return { data: null, error: "This Google Cloud project doesn't have the Business Profile APIs enabled yet (Account Management + Business Information)." };
      }
      return { data: null, error: "Google refused access to this Business Profile. The Google account that connected it may no longer be an owner or manager — reconnect with one that is." };
    }
    if (r.status === 401) return { data: null, error: "Google access expired or was revoked — reconnect." };
    if (r.status === 429 || err?.status === "RESOURCE_EXHAUSTED") {
      // Google enforces a near-zero default quota on these endpoints until the
      // Business Profile API access request is approved, and reports it as
      // RESOURCE_EXHAUSTED (429) rather than a clean permission error. A 429 on
      // an account's first-ever call to this API is almost always THIS, not
      // genuine traffic-based throttling — waiting won't fix it.
      if (/quota exceeded|per minute|per day/i.test(msg)) {
        return { data: null, error: `Google's default quota for this API is exhausted — this happens immediately for projects still waiting on Business Profile API access approval (separate from OAuth verification, can take a few weeks). Not a temporary rate limit. Google's exact message: "${msg}"` };
      }
      return { data: null, error: `Google is rate-limiting this project — try again shortly. Google's message: "${msg}"` };
    }
    return { data: null, error: msg || `Google API error (${r.status})` };
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : "Google API request failed" };
  }
}

// ── Picker: accounts this Google login manages, and each account's locations.
export interface GrAccount { id: string; name: string }
export async function listAccounts(creds: GrCreds): Promise<{ accounts: GrAccount[]; error?: string }> {
  const token = await accessTokenFor(creds);
  if (!token) return { accounts: [], error: "Could not get a Google access token — reconnect." };
  const { data, error } = await apiGetDetailed(token, `${ACCOUNTS_API}/accounts`);
  if (error) return { accounts: [], error };
  const items = (data?.accounts as Record<string, unknown>[] | undefined) ?? [];
  const accounts = items.map(a => ({ id: (a.name as string) ?? "", name: (a.accountName as string) ?? (a.name as string) ?? "" })).filter(a => a.id);
  if (!accounts.length) {
    return { accounts: [], error: "This Google account doesn't manage any Business Profile. Sign in with the account that owns the business listing." };
  }
  return { accounts };
}

export interface GrLocation { accountId: string; id: string; name: string; address: string }
export async function listLocations(creds: GrCreds, accountId: string): Promise<{ locations: GrLocation[]; error?: string }> {
  const token = await accessTokenFor(creds);
  if (!token) return { locations: [], error: "Could not get a Google access token — reconnect." };
  const qs = new URLSearchParams({ readMask: "name,title,storefrontAddress" }).toString();
  const { data, error } = await apiGetDetailed(token, `${INFO_API}/${accountId}/locations?${qs}`);
  if (error) return { locations: [], error };
  const items = (data?.locations as Record<string, unknown>[] | undefined) ?? [];
  const locations = items.map(l => {
    const addr = (l.storefrontAddress as Record<string, unknown> | undefined) ?? {};
    const lines = (addr.addressLines as string[] | undefined) ?? [];
    return {
      accountId,
      id: (l.name as string) ?? "",
      name: (l.title as string) ?? (l.name as string) ?? "",
      address: [...lines, addr.locality as string, addr.administrativeArea as string].filter(Boolean).join(", "),
    };
  }).filter(l => l.id);
  return { locations };
}

// ── Reviews (legacy v4 — gated, see file header) ─────────────────────────────
const STAR_MAP: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

export interface GrReview {
  externalId: string;      // full review resource name — the reply target
  author: string;
  rating: number;
  text: string;
  createTime: string | null;
  updateTime: string | null;
  existingReply: string | null;   // set when the owner already replied via Google directly
}

// Fetches up to `maxPages` pages (v4 caps pageSize at 50). No time filter exists
// on this endpoint — the caller de-dupes against already-imported reviews.
export class GoogleReviewsError extends Error {
  constructor(message: string) { super(message); this.name = "GoogleReviewsError"; }
}

// Throws GoogleReviewsError when Google can't be read, so a lost connection is
// never mistaken for a location with no reviews.
export async function listReviews(creds: GrCreds, maxPages = 4): Promise<GrReview[]> {
  if (!creds.accountId || !creds.locationId) throw new GoogleReviewsError("No Business Profile location is selected for this connection.");
  const token = await accessTokenFor(creds);
  if (!token) throw new GoogleReviewsError("Google access expired or was revoked — reconnect.");
  const out: GrReview[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const qs = new URLSearchParams({ pageSize: "50", ...(pageToken ? { pageToken } : {}) }).toString();
    const { data, error } = await apiGetDetailed(token, `${REVIEWS_API}/${creds.accountId}/${creds.locationId}/reviews?${qs}`);
    // A later page failing would still lose reviews, so never return a partial list as complete.
    if (error || !data) throw new GoogleReviewsError(error ?? "Google returned an empty response.");
    const items = (data.reviews as Record<string, unknown>[] | undefined) ?? [];
    for (const r of items) {
      const reviewer = (r.reviewer as Record<string, unknown> | undefined) ?? {};
      const existingReply = (r.reviewReply as Record<string, unknown> | undefined)?.comment as string | undefined;
      out.push({
        externalId: (r.name as string) ?? "",
        author: (reviewer.displayName as string) ?? "Anonymous",
        rating: STAR_MAP[(r.starRating as string) ?? ""] ?? 5,
        text: (r.comment as string) ?? "",
        createTime: (r.createTime as string) ?? null,
        updateTime: (r.updateTime as string) ?? null,
        existingReply: existingReply ?? null,
      });
    }
    pageToken = data.nextPageToken as string | undefined;
    if (!pageToken) break;
  }
  return out.filter(r => r.externalId);
}

export interface GrResult { ok: boolean; error?: string }

// Post/update the owner reply on a review. PUT is idempotent (replaces any
// existing reply), so this also serves as "edit reply".
export async function replyToReview(creds: GrCreds, reviewExternalId: string, text: string, tenantId?: string): Promise<GrResult> {
  const token = await accessTokenFor(creds);
  if (!token) return { ok: false, error: "Google Reviews isn't connected" };
  // A review reply is public and posted on the business's own Google profile.
  if (!(await moderateText(text, { tenantId, surface: "review_reply" })).allowed) {
    return { ok: false, error: "Blocked by the content safety filter" };
  }
  try {
    const r = await fetch(`${REVIEWS_API}/${reviewExternalId}/reply`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ comment: text.slice(0, 4000) }),
    });
    if (!r.ok) {
      const j = (await r.json().catch(() => null)) as { error?: { message?: string } } | null;
      return { ok: false, error: j?.error?.message || `Google reply failed (${r.status})` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Google reply error" };
  }
}

export async function deleteReviewReply(creds: GrCreds, reviewExternalId: string): Promise<GrResult> {
  const token = await accessTokenFor(creds);
  if (!token) return { ok: false, error: "Google Reviews isn't connected" };
  try {
    const r = await fetch(`${REVIEWS_API}/${reviewExternalId}/reply`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok && r.status !== 404) {
      const j = (await r.json().catch(() => null)) as { error?: { message?: string } } | null;
      return { ok: false, error: j?.error?.message || `Google delete-reply failed (${r.status})` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Google delete-reply error" };
  }
}
