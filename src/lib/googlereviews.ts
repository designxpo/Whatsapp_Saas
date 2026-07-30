// Google Business Profile client — Reviews module (Phase 2).
//
// Three DIFFERENT Google API generations are involved, because Google split up
// the old "Google My Business API" over the years:
//   - Account Management API  (mybusinessaccountmanagement) — list accounts.
//   - Business Information API (mybusinessbusinessinformation) — list locations.
//   - The legacy v4 "My Business API" (mybusiness.googleapis.com/v4) — reviews
//     list/reply/delete-reply. This is the ONE Google still gates behind a
//     separate access request (the "Business Profile APIs" form) — an approved
//     OAuth client can still get 403s here until that's granted. Everything in
//     this file fails soft (returns [] / {ok:false}) rather than throwing, so a
//     pending approval degrades to "no reviews yet", not a crash.
//
// Auth: reuses the SAME Google OAuth client as YouTube (youtube.ts) — one
// Google Cloud project, two scopes. A per-channel OAuth refresh token (stored
// encrypted in wa_channels.access_token) is exchanged for a short-lived access
// token at call time.

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

async function apiGet(token: string, url: string): Promise<Record<string, unknown> | null> {
  try {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const j = (await r.json().catch(() => null)) as Record<string, unknown> | null;
    return r.ok ? j : null;
  } catch { return null; }
}

// ── Picker: accounts this Google login manages, and each account's locations.
export interface GrAccount { id: string; name: string }
export async function listAccounts(creds: GrCreds): Promise<GrAccount[]> {
  const token = await accessTokenFor(creds);
  if (!token) return [];
  const data = await apiGet(token, `${ACCOUNTS_API}/accounts`);
  const items = (data?.accounts as Record<string, unknown>[] | undefined) ?? [];
  return items.map(a => ({ id: (a.name as string) ?? "", name: (a.accountName as string) ?? (a.name as string) ?? "" })).filter(a => a.id);
}

export interface GrLocation { accountId: string; id: string; name: string; address: string }
export async function listLocations(creds: GrCreds, accountId: string): Promise<GrLocation[]> {
  const token = await accessTokenFor(creds);
  if (!token) return [];
  const qs = new URLSearchParams({ readMask: "name,title,storefrontAddress" }).toString();
  const data = await apiGet(token, `${INFO_API}/${accountId}/locations?${qs}`);
  const items = (data?.locations as Record<string, unknown>[] | undefined) ?? [];
  return items.map(l => {
    const addr = (l.storefrontAddress as Record<string, unknown> | undefined) ?? {};
    const lines = (addr.addressLines as string[] | undefined) ?? [];
    return {
      accountId,
      id: (l.name as string) ?? "",
      name: (l.title as string) ?? (l.name as string) ?? "",
      address: [...lines, addr.locality as string, addr.administrativeArea as string].filter(Boolean).join(", "),
    };
  }).filter(l => l.id);
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
export async function listReviews(creds: GrCreds, maxPages = 4): Promise<GrReview[]> {
  if (!creds.accountId || !creds.locationId) return [];
  const token = await accessTokenFor(creds);
  if (!token) return [];
  const out: GrReview[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const qs = new URLSearchParams({ pageSize: "50", ...(pageToken ? { pageToken } : {}) }).toString();
    const data = await apiGet(token, `${REVIEWS_API}/${creds.accountId}/${creds.locationId}/reviews?${qs}`);
    if (!data) break;
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
export async function replyToReview(creds: GrCreds, reviewExternalId: string, text: string): Promise<GrResult> {
  const token = await accessTokenFor(creds);
  if (!token) return { ok: false, error: "Google Reviews isn't connected" };
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
