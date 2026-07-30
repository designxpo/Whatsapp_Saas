// YouTube Data API v3 client — comment automation sender (Module 1).
//
// Compliance-first, like the IG/FB senders:
//   1. Official Data API v3 only (no scraping).
//   2. Public replies only (YouTube has no DM surface).
//   3. RATE PACING — a per-channel hourly cap so bursts don't trip YouTube's
//      spam heuristics (repetitive automated replies get accounts struck).
//   4. QUOTA is the real ceiling (default 10k units/day PER PROJECT, shared
//      across all tenants): commentThreads.list=1, comments.insert=50,
//      setModerationStatus=50. Callers must poll incrementally and batch.
//
// Auth: per-channel OAuth **refresh token** (stored encrypted in
// wa_channels.access_token). We exchange it for a short-lived access token at
// call time using the shared Google OAuth client. Everything here no-ops safely
// when the client env vars or a channel refresh token are absent (Phase 1a is
// dormant until the OAuth client is approved).

const API = "https://www.googleapis.com/youtube/v3";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const MAX_COMMENT_REPLIES_PER_HOUR = 60;   // per-channel public-reply pacing

export interface YtCreds {
  channelId: string;      // the connected YouTube channel id
  refreshToken: string;   // OAuth refresh token (decrypted)
}

export interface YtVideo { id: string; title: string; thumbnail: string; publishedAt: string }
export interface YtComment {
  id: string;             // top-level comment id (reply target)
  videoId: string;
  text: string;
  authorChannelId: string | null;
  publishedAt: string;
}

// True when the shared Google OAuth client is configured for this deployment.
export function youtubeConfigured(): boolean {
  return !!(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET);
}

// ── Rate pacing (best-effort, in-process) — same sliding window as instagram.ts.
// Serverless instances don't share memory, so this is a soft guard; it still
// curbs per-instance bursts. Keyed per channel so channels pace independently.
const replyTimes = new Map<string, number[]>();
function withinRate(channelId: string, max: number): boolean {
  const now = Date.now();
  const cutoff = now - 60 * 60 * 1000;
  const arr = (replyTimes.get(channelId) ?? []).filter(t => t > cutoff);
  if (arr.length >= max) { replyTimes.set(channelId, arr); return false; }
  arr.push(now);
  replyTimes.set(channelId, arr);
  return true;
}

// ── Access-token exchange (refresh-token grant) ──────────────────────────────
// Cached in-process per channel until ~1 min before expiry to save quota-free
// but rate-limited token endpoint calls.
const tokenCache = new Map<string, { token: string; expiresAt: number }>();
async function accessTokenFor(creds: YtCreds): Promise<string | null> {
  if (!youtubeConfigured() || !creds.refreshToken) return null;
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

async function apiGet(token: string, path: string, params: Record<string, string>): Promise<Record<string, unknown> | null> {
  try {
    const qs = new URLSearchParams(params).toString();
    const r = await fetch(`${API}/${path}?${qs}`, { headers: { Authorization: `Bearer ${token}` } });
    const j = (await r.json().catch(() => null)) as Record<string, unknown> | null;
    return r.ok ? j : null;
  } catch { return null; }
}

// ── Video picker: the channel's most recent uploads ──────────────────────────
export async function listVideos(creds: YtCreds, limit = 25): Promise<YtVideo[]> {
  const token = await accessTokenFor(creds);
  if (!token) return [];
  // search.list is 100 units — acceptable for an occasional picker load. Order by
  // date, restrict to this channel's own videos.
  const data = await apiGet(token, "search", {
    part: "snippet", channelId: creds.channelId, order: "date", type: "video",
    maxResults: String(Math.min(50, Math.max(1, limit))),
  });
  const items = (data?.items as Record<string, unknown>[] | undefined) ?? [];
  return items.map(it => {
    const id = ((it.id as Record<string, unknown>)?.videoId as string) ?? "";
    const sn = (it.snippet as Record<string, unknown>) ?? {};
    const thumbs = (sn.thumbnails as Record<string, Record<string, unknown>>) ?? {};
    const thumb = (thumbs.medium?.url as string) || (thumbs.default?.url as string) || "";
    return { id, title: (sn.title as string) ?? "", thumbnail: thumb, publishedAt: (sn.publishedAt as string) ?? "" };
  }).filter(v => v.id);
}

// ── Incremental comment poll ─────────────────────────────────────────────────
// Lists top-level comment threads on the channel, newest first, stopping once we
// pass `since` (the last poll cursor). commentThreads.list = 1 unit/page.
export async function listNewComments(creds: YtCreds, since: Date | null, maxPages = 3): Promise<YtComment[]> {
  const token = await accessTokenFor(creds);
  if (!token) return [];
  const out: YtComment[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const params: Record<string, string> = {
      part: "snippet", allThreadsRelatedToChannelId: creds.channelId,
      order: "time", maxResults: "50", textFormat: "plainText",
    };
    if (pageToken) params.pageToken = pageToken;
    const data = await apiGet(token, "commentThreads", params);
    if (!data) break;
    const items = (data.items as Record<string, unknown>[] | undefined) ?? [];
    let hitOld = false;
    for (const it of items) {
      const topSnippet = ((it.snippet as Record<string, unknown>)?.topLevelComment as Record<string, unknown>) ?? {};
      const cs = (topSnippet.snippet as Record<string, unknown>) ?? {};
      const publishedAt = (cs.updatedAt as string) || (cs.publishedAt as string) || "";
      if (since && publishedAt && new Date(publishedAt).getTime() <= since.getTime()) { hitOld = true; break; }
      const authorChannel = (cs.authorChannelId as Record<string, unknown> | undefined)?.value as string | undefined;
      out.push({
        id: (topSnippet.id as string) ?? "",
        videoId: (cs.videoId as string) ?? "",
        text: (cs.textDisplay as string) ?? (cs.textOriginal as string) ?? "",
        authorChannelId: authorChannel ?? null,
        publishedAt,
      });
    }
    pageToken = data.nextPageToken as string | undefined;
    if (hitOld || !pageToken) break;
  }
  return out.filter(c => c.id);
}

export interface YtSendResult { ok: boolean; id?: string; error?: string; blockedBy?: "rate" | "config" }

// Post a public reply under a top-level comment. comments.insert = 50 units.
export async function replyToComment(creds: YtCreds, parentCommentId: string, text: string): Promise<YtSendResult> {
  if (!parentCommentId || !text.trim()) return { ok: false, error: "parent comment and text required" };
  const token = await accessTokenFor(creds);
  if (!token) return { ok: false, blockedBy: "config", error: "YouTube is not connected on this deployment" };
  if (!withinRate(creds.channelId, MAX_COMMENT_REPLIES_PER_HOUR)) return { ok: false, blockedBy: "rate", error: "Hourly reply cap reached for this channel" };
  try {
    const r = await fetch(`${API}/comments?part=snippet`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ snippet: { parentId: parentCommentId, textOriginal: text.slice(0, 9000) } }),
    });
    const j = (await r.json().catch(() => null)) as { id?: string; error?: { message?: string } } | null;
    if (!r.ok || !j?.id) return { ok: false, error: j?.error?.message || `YouTube reply failed (${r.status})` };
    return { ok: true, id: j.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "YouTube reply error" };
  }
}

// Moderate a comment. comments.setModerationStatus = 50 units. status:
// "heldForReview" | "rejected" | "published". `banAuthor` only valid with rejected.
export async function setModeration(creds: YtCreds, commentId: string, status: "heldForReview" | "rejected" | "published"): Promise<YtSendResult> {
  if (!commentId) return { ok: false, error: "comment id required" };
  const token = await accessTokenFor(creds);
  if (!token) return { ok: false, blockedBy: "config", error: "YouTube is not connected on this deployment" };
  try {
    const qs = new URLSearchParams({ id: commentId, moderationStatus: status }).toString();
    const r = await fetch(`${API}/comments/setModerationStatus?${qs}`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) {
      const j = (await r.json().catch(() => null)) as { error?: { message?: string } } | null;
      return { ok: false, error: j?.error?.message || `YouTube moderation failed (${r.status})` };
    }
    return { ok: true, id: commentId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "YouTube moderation error" };
  }
}
