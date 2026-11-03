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

// Why a Google call failed, so callers can act on it: "reauth" needs the owner
// to reconnect, "permission" needs a login that manages the profile,
// "rate_limit" and "transient" fix themselves and are retried on a later run.
export type GrErrorKind = "reauth" | "permission" | "rate_limit" | "transient" | "other";
export interface GrTokenResult { token?: string; error?: string; kind?: GrErrorKind }

const REAUTH = "Google access expired or was revoked — reconnect.";
const TIMEOUT_MS = 15_000;
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
/** Waits between attempts at a temporary Google failure. Tests set it to [0, 0]. */
export const retryDelays = { ms: [800, 2_400] };

export async function tokenFor(creds: GrCreds): Promise<GrTokenResult> {
  if (!googleReviewsConfigured()) return { error: "Google Reviews isn't configured on this deployment.", kind: "other" };
  if (!creds.refreshToken) return { error: REAUTH, kind: "reauth" };
  const cached = tokenCache.get(creds.channelId);
  if (cached && cached.expiresAt - 60_000 > Date.now()) return { token: cached.token };
  let last: GrTokenResult = { error: "Couldn't reach Google to refresh access.", kind: "transient" };
  for (let attempt = 0; attempt <= retryDelays.ms.length; attempt++) {
    if (attempt) await sleep(retryDelays.ms[attempt - 1]);
    try {
      const body = new URLSearchParams({
        client_id: process.env.GOOGLE_OAUTH_CLIENT_ID as string,
        client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET as string,
        refresh_token: creds.refreshToken,
        grant_type: "refresh_token",
      });
      const r = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(TIMEOUT_MS) });
      const j = (await r.json().catch(() => null)) as { access_token?: string; expires_in?: number; error?: string } | null;
      if (r.ok && j?.access_token) {
        tokenCache.set(creds.channelId, { token: j.access_token, expiresAt: Date.now() + (j.expires_in ?? 3600) * 1000 });
        return { token: j.access_token };
      }
      // invalid_grant: the owner revoked access, changed their password, or the
      // token aged out. Only reconnecting fixes it, so don't retry.
      if (j?.error === "invalid_grant" || r.status === 400 || r.status === 401) return { error: REAUTH, kind: "reauth" };
      last = { error: `Google couldn't refresh access right now (${r.status}).`, kind: r.status === 429 ? "rate_limit" : "transient" };
    } catch {
      last = { error: "Couldn't reach Google to refresh access.", kind: "transient" };
    }
  }
  return last;
}

// Keeps Google's error instead of collapsing every failure to null. Without
// this, "this Google account manages no Business Profile" is indistinguishable
// from "the API isn't enabled" or "the access request isn't approved" — the
// three very different reasons the location picker can come back empty.
interface ApiOut { data: Record<string, unknown> | null; error?: string; kind?: GrErrorKind }

async function apiOnce(token: string, url: string, init: RequestInit = {}): Promise<ApiOut> {
  try {
    const r = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const j = (await r.json().catch(() => null)) as Record<string, unknown> | null;
    if (r.ok) return { data: j ?? {} };
    const err = j?.error as { message?: string; status?: string } | undefined;
    const msg = err?.message ?? "";
    if (err?.status === "PERMISSION_DENIED" || r.status === 403) {
      // Google uses SERVICE_DISABLED when the API isn't switched on for the
      // project. Talko's Business Profile API access is approved (3 Nov 2026),
      // so a plain denial now means this Google login can't manage the profile.
      if (/SERVICE_DISABLED|has not been used in project|is disabled/i.test(msg)) {
        return { data: null, kind: "other", error: "Google Reviews is temporarily unavailable on Talko. Our team has been told." };
      }
      return { data: null, kind: "permission", error: "Google refused access to this Business Profile. The Google account that connected it may no longer be an owner or manager — reconnect with one that is." };
    }
    if (r.status === 401) return { data: null, kind: "reauth", error: REAUTH };
    if (r.status === 404) return { data: null, kind: "other", error: "Google couldn't find this business location. It may have been removed or moved to another account — reconnect and pick it again." };
    if (r.status === 429 || err?.status === "RESOURCE_EXHAUSTED") {
      return { data: null, kind: "rate_limit", error: "Google is limiting how often Talko can read reviews right now. Talko tries again automatically." };
    }
    if (r.status >= 500) return { data: null, kind: "transient", error: `Google had a temporary problem (${r.status}). Talko tries again automatically.` };
    return { data: null, kind: "other", error: msg || `Google API error (${r.status})` };
  } catch (e) {
    const timedOut = e instanceof Error && /timeout|abort/i.test(e.name + e.message);
    return { data: null, kind: "transient", error: timedOut ? "Google took too long to answer. Talko tries again automatically." : "Couldn't reach Google. Talko tries again automatically." };
  }
}

// Keeps Google's error instead of collapsing every failure to null, and
// retries only what can fix itself (rate limits, 5xx, timeouts), a bounded
// number of times. PUT and DELETE of a reply are idempotent, so retrying them
// can't post twice.
async function apiCall(token: string, url: string, init: RequestInit = {}): Promise<ApiOut> {
  let out = await apiOnce(token, url, init);
  for (const delay of retryDelays.ms) {
    if (!out.error || (out.kind !== "transient" && out.kind !== "rate_limit")) break;
    await sleep(delay);
    out = await apiOnce(token, url, init);
  }
  return out;
}
const apiGetDetailed = (token: string, url: string) => apiCall(token, url);

// ── Picker: accounts this Google login manages, and each account's locations.
// Both lists page: a chain with dozens of branches must be able to pick any.
export interface GrAccount { id: string; name: string }
const MAX_LIST_PAGES = 10;

export async function listAccounts(creds: GrCreds): Promise<{ accounts: GrAccount[]; error?: string; kind?: GrErrorKind }> {
  const t = await tokenFor(creds);
  if (!t.token) return { accounts: [], error: t.error, kind: t.kind };
  const accounts: GrAccount[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const qs = new URLSearchParams({ pageSize: "20", ...(pageToken ? { pageToken } : {}) }).toString();
    const { data, error, kind } = await apiGetDetailed(t.token, `${ACCOUNTS_API}/accounts?${qs}`);
    if (error) return { accounts, error, kind };
    for (const a of (data?.accounts as Record<string, unknown>[] | undefined) ?? []) {
      const id = (a.name as string) ?? "";
      if (id) accounts.push({ id, name: (a.accountName as string) ?? id });
    }
    pageToken = data?.nextPageToken as string | undefined;
    if (!pageToken) break;
  }
  return { accounts };
}

export interface GrLocation { accountId: string; id: string; name: string; address: string }
export async function listLocations(creds: GrCreds, accountId: string): Promise<{ locations: GrLocation[]; error?: string; kind?: GrErrorKind }> {
  const t = await tokenFor(creds);
  if (!t.token) return { locations: [], error: t.error, kind: t.kind };
  const locations: GrLocation[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const qs = new URLSearchParams({ readMask: "name,title,storefrontAddress", pageSize: "100", ...(pageToken ? { pageToken } : {}) }).toString();
    const { data, error, kind } = await apiGetDetailed(t.token, `${INFO_API}/${accountId}/locations?${qs}`);
    if (error) return { locations, error, kind };
    for (const l of (data?.locations as Record<string, unknown>[] | undefined) ?? []) {
      const addr = (l.storefrontAddress as Record<string, unknown> | undefined) ?? {};
      const lines = (addr.addressLines as string[] | undefined) ?? [];
      const id = (l.name as string) ?? "";
      if (id) locations.push({
        accountId, id,
        name: (l.title as string) ?? id,
        address: [...lines, addr.locality as string, addr.administrativeArea as string].filter(Boolean).join(", "),
      });
    }
    pageToken = data?.nextPageToken as string | undefined;
    if (!pageToken) break;
  }
  return { locations };
}

// The location's public links (Business Information API metadata): where a
// customer writes a review, and the location's Google Maps page. Google gives
// no per-review web address, so the Maps page is the honest "see on Google".
export async function locationLinks(creds: GrCreds): Promise<{ reviewUri?: string; mapsUri?: string; error?: string }> {
  if (!creds.locationId) return { error: "No Business Profile location is selected for this connection." };
  const t = await tokenFor(creds);
  if (!t.token) return { error: t.error };
  const { data, error } = await apiGetDetailed(t.token, `${INFO_API}/${creds.locationId}?readMask=metadata`);
  if (error) return { error };
  const md = (data?.metadata as Record<string, unknown> | undefined) ?? {};
  const https = (v: unknown) => (typeof v === "string" && v.startsWith("https://") ? v : undefined);
  return { reviewUri: https(md.newReviewUri), mapsUri: https(md.mapsUri) };
}

export async function locationReviewUrl(creds: GrCreds): Promise<{ url?: string; error?: string }> {
  const r = await locationLinks(creds);
  if (r.error) return { error: r.error };
  return r.reviewUri ? { url: r.reviewUri } : { error: "Google didn't give a review link for this profile — it may not be verified yet. Paste the link instead." };
}

// ── Reviews (legacy v4) ──────────────────────────────────────────────────────
const STAR_MAP: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

export interface GrReview {
  externalId: string;      // full review resource name — the reply target
  author: string;
  /** 1–5, or 0 when Google didn't say (never treated as a high rating). */
  rating: number;
  text: string;
  createTime: string | null;
  updateTime: string | null;
  existingReply: string | null;   // set when the owner already replied via Google directly
  existingReplyTime: string | null;
}

export class GoogleReviewsError extends Error {
  kind: GrErrorKind;
  constructor(message: string, kind: GrErrorKind = "other") { super(message); this.name = "GoogleReviewsError"; this.kind = kind; }
}

export interface GrReviewPage {
  reviews: GrReview[];
  nextPageToken: string | null;
  /** Google's own figures for the whole location, not just what Talko imported. */
  averageRating: number | null;
  totalReviewCount: number | null;
}

function mapGoogleReview(r: Record<string, unknown>): GrReview {
  const reviewer = (r.reviewer as Record<string, unknown> | undefined) ?? {};
  const reply = (r.reviewReply as Record<string, unknown> | undefined) ?? null;
  return {
    externalId: (r.name as string) ?? "",
    author: (reviewer.displayName as string) || "Anonymous",
    rating: STAR_MAP[(r.starRating as string) ?? ""] ?? 0,
    text: (r.comment as string) ?? "",
    createTime: (r.createTime as string) ?? null,
    updateTime: (r.updateTime as string) ?? null,
    existingReply: (reply?.comment as string | undefined) ?? null,
    existingReplyTime: (reply?.updateTime as string | undefined) ?? null,
  };
}

// One page, newest-changed first (v4 caps pageSize at 50). Throws
// GoogleReviewsError when Google can't be read, so a lost connection is never
// mistaken for a location with no reviews.
export async function fetchReviewPage(creds: GrCreds, pageToken?: string | null): Promise<GrReviewPage> {
  if (!creds.accountId || !creds.locationId) throw new GoogleReviewsError("No Business Profile location is selected for this connection.");
  const t = await tokenFor(creds);
  if (!t.token) throw new GoogleReviewsError(t.error ?? REAUTH, t.kind ?? "reauth");
  const qs = new URLSearchParams({ pageSize: "50", orderBy: "updateTime desc", ...(pageToken ? { pageToken } : {}) }).toString();
  const { data, error, kind } = await apiGetDetailed(t.token, `${REVIEWS_API}/${creds.accountId}/${creds.locationId}/reviews?${qs}`);
  if (error || !data) throw new GoogleReviewsError(error ?? "Google returned an empty response.", kind ?? "other");
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    reviews: ((data.reviews as Record<string, unknown>[] | undefined) ?? []).map(mapGoogleReview).filter(r => r.externalId),
    nextPageToken: (data.nextPageToken as string | undefined) ?? null,
    averageRating: num(data.averageRating),
    totalReviewCount: num(data.totalReviewCount),
  };
}

// Several pages at once. A later page failing throws too: never return a
// partial list as if it were complete.
export async function listReviews(creds: GrCreds, maxPages = 4): Promise<GrReview[]> {
  const out: GrReview[] = [];
  let pageToken: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const p: GrReviewPage = await fetchReviewPage(creds, pageToken);
    out.push(...p.reviews);
    pageToken = p.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

export interface GrResult { ok: boolean; error?: string; kind?: GrErrorKind }

// Post/update the owner reply on a review. PUT is idempotent (replaces any
// existing reply), so this also serves as "edit reply", and a retry can't
// post twice.
export async function replyToReview(creds: GrCreds, reviewExternalId: string, text: string, tenantId?: string): Promise<GrResult> {
  const t = await tokenFor(creds);
  if (!t.token) return { ok: false, error: t.error ?? "Google Reviews isn't connected", kind: t.kind };
  // A review reply is public and posted on the business's own Google profile.
  if (!(await moderateText(text, { tenantId, surface: "review_reply" })).allowed) {
    return { ok: false, error: "Blocked by the content safety filter", kind: "other" };
  }
  const { error, kind } = await apiCall(t.token, `${REVIEWS_API}/${reviewExternalId}/reply`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ comment: text.slice(0, 4000) }),
  });
  return error ? { ok: false, error, kind } : { ok: true };
}

export async function deleteReviewReply(creds: GrCreds, reviewExternalId: string): Promise<GrResult> {
  const t = await tokenFor(creds);
  if (!t.token) return { ok: false, error: t.error ?? "Google Reviews isn't connected", kind: t.kind };
  const { error, kind } = await apiCall(t.token, `${REVIEWS_API}/${reviewExternalId}/reply`, { method: "DELETE" });
  // Already gone on Google is the outcome we wanted.
  if (error && !/couldn't find/i.test(error)) return { ok: false, error, kind };
  return { ok: true };
}
