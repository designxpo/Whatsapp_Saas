// Importing the replies posted before the reply log existed — up to a year
// back — so "Replies sent" has history, not just what was posted since.
//
// It runs from the background engine a little at a time: a few API pages per
// account per tick, a few accounts per tick, never inside a request. So it
// can't load YouTube, Meta or the database, and a slow platform only makes it
// take a few more ticks. Each account is imported once; from then on replies
// are recorded as they are posted (comment-replies.ts).
//
// Only replies written BY the account itself are kept. Who wrote them comes
// from the automation's own claim logs (every comment the AI or a rule acted
// on is claimed): claimed by a rule → "rule", claimed with no rule → "ai" (a
// follow-up inside a thread → "ai_followup"), not claimed → "manual" — a person
// replied in the platform's own app.

import { db } from "./supabase";
import { listChannels, isLiveChannel, type Channel } from "./channels";
import { listThreadsPage, type YtThread } from "./youtube";
import { listIgMediaPage, listIgCommentsPage, listIgReplies, getIgSelf, getIgCommentAuthor, type IgCommentNode } from "./instagram";
import { listFbPostsPage, listFbCommentsPage, getFbCommentAuthor, type FbCommentNode } from "./messenger";
import { importCommentReplies, type ImportedReply, type ReplyPlatform, type ReplySource } from "./comment-replies";
import { setTenantSetting } from "./store";

export const HISTORY_DAYS = 365;
const PREFIX = "reply_history:";
const CALLS_PER_ACCOUNT = 8;     // API pages one account may use per tick
const IG_CALLS_PER_ACCOUNT = 16; // Instagram also reads each answered comment's replies
const ACCOUNTS_PER_TICK = 3;
export const PLATFORM_OF: Record<string, ReplyPlatform> = { youtube: "youtube", instagram: "instagram", messenger: "facebook" };

// Bumped when a platform's matching changes, so its accounts are read again.
// v2: Instagram recognises the account by both of its ids and its @username.
// v3: Instagram replies fetched with their authors (nested ones come without),
//     and Instagram/Facebook first seeded from the app's own reply records.
const VERSION = 3;

export interface HistoryState {
  v?: number;
  since: string; startedAt: string; done: boolean; imported: number;
  cursor: string | null;                          // the next page of threads / posts
  listDone?: boolean;                             // posts: no more to list
  queue?: { id: string; after: string | null }[]; // posts still to read comments from
  selfName?: string | null;                       // Instagram: the account's @username
  selfIds?: string[];                             // Instagram: every id it may be reported under
  seeded?: number;                                // replies imported from the app's own records
  failures?: number;                              // failed runs in a row
  // What the platform returned, so a run that finds nothing can be told apart
  // from one that can't recognise the account's own replies.
  seen?: { comments: number; commentsWithName?: number; replies: number; repliesWithName: number; repliesWithId: number; ours: number; repliesError?: string };
  error?: string | null; finishedAt?: string;
}

export function freshState(now = Date.now()): HistoryState {
  return { v: VERSION, since: new Date(now - HISTORY_DAYS * 86_400_000).toISOString(), startedAt: new Date(now).toISOString(), done: false, imported: 0, cursor: null };
}

type Claims = Map<string, string | null>;   // claimed comment id → rule id (null: the AI)

function sourceFor(answeredId: string, answeredIsTop: boolean, claims: Claims): ReplySource {
  if (!claims.has(answeredId)) return "manual";
  if (claims.get(answeredId)) return "rule";
  return answeredIsTop ? "ai" : "ai_followup";
}

// ── Pure: our replies out of what a platform returned ───────────────────────

/** YouTube: replies by the channel itself, each with the comment it answered (the latest one by someone else). */
export function ytRepliesFromThreads(threads: YtThread[], channelId: string, since: number, claims: Claims): ImportedReply[] {
  const out: ImportedReply[] = [];
  for (const t of threads) {
    let answered = t.top;
    for (const r of t.replies) {
      if (r.authorChannelId !== channelId) { answered = r; continue; }
      if (answered.authorChannelId === channelId || Date.parse(r.publishedAt) < since) continue;
      out.push({
        platform: "youtube", parentCommentId: answered.id, commentText: answered.text, commentAuthor: answered.authorName || null, commentAuthorId: answered.authorChannelId || null,
        postId: t.videoId || null, replyId: r.id, replyText: r.text, createdAt: r.publishedAt,
        source: sourceFor(answered.id, answered.id === t.top.id, claims),
      });
    }
  }
  return out;
}

type Node = { id: string; text: string; author: string; fromId: string | null; at: string; replies: Node[] };
function repliesFromNodes(platform: ReplyPlatform, nodes: Node[], isOurs: (n: Node) => boolean, postId: string, since: number, claims: Claims): ImportedReply[] {
  const out: ImportedReply[] = [];
  for (const top of nodes) {
    if (isOurs(top)) continue;   // a comment the account left on its own post
    let answered = top;
    for (const r of [...top.replies].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) {
      if (!isOurs(r)) { answered = r; continue; }
      if (Date.parse(r.at) < since) continue;
      out.push({
        platform, parentCommentId: answered.id, commentText: answered.text, commentAuthor: answered.author || null, commentAuthorId: answered.fromId || null,
        postId, replyId: r.id, replyText: r.text, createdAt: r.at, source: sourceFor(answered.id, answered.id === top.id, claims),
      });
    }
  }
  return out;
}

/** Instagram: matched by any id the account is reported under, or its @username. */
export function igRepliesFromComments(comments: IgCommentNode[], selfIds: string[], selfName: string | null, mediaId: string, since: number, claims: Claims): ImportedReply[] {
  const toNode = (c: IgCommentNode): Node => ({ id: c.id, text: c.text, author: c.username ? `@${c.username}` : "", fromId: c.fromId, at: c.timestamp, replies: c.replies.map(toNode) });
  const ids = new Set(selfIds.filter(Boolean));
  const self = selfName?.toLowerCase() ?? null;
  return repliesFromNodes("instagram", comments.map(toNode), n => (!!n.fromId && ids.has(n.fromId)) || (!!self && n.author.toLowerCase() === `@${self}`), mediaId, since, claims);
}

// A token that's been revoked or expired won't come right by retrying.
const AUTH_ERROR = /oauth|access token|invalid_grant|expired|revoked|not authori[sz]ed|has not authorized|permission/i;
/** Note a failed run. Ends the account's import on an access error, or after three failures in a row. */
function failed(st: HistoryState, error: string): void {
  st.error = error;
  st.failures = (st.failures ?? 0) + 1;
  if (AUTH_ERROR.test(error) || st.failures >= 3) st.done = true;
}

/** Facebook: comments written by the Page itself. */
export function fbRepliesFromComments(comments: FbCommentNode[], pageId: string, postId: string, since: number, claims: Claims): ImportedReply[] {
  const toNode = (c: FbCommentNode): Node => ({ id: c.id, text: c.text, author: c.fromName, fromId: c.fromId, at: c.createdTime, replies: c.replies.map(toNode) });
  return repliesFromNodes("facebook", comments.map(toNode), n => n.fromId === pageId, postId, since, claims);
}

// ── From the app's own records ──────────────────────────────────────────────
// Every automated public reply on Instagram/Facebook is recorded in
// wa_comment_threads as a pair — the customer's comment (watch id = root) and
// the reply the account posted (watch id ≠ root), with both texts. That names
// the account's own replies by id, with no need for Instagram to say who wrote
// them (nested replies come back without an author: 25 of 25 in production,
// 2026-11-01). Follow-ups deeper in a thread (depth > 0) pair the account's
// reply with the customer's next comment, so they can't be told apart here and
// are left to the platform walk.
export interface ThreadRecord { watch_comment_id: string; root_comment_id: string; original_text: string | null; reply_text: string | null; depth: number; created_at: string }
export function repliesFromRecords(platform: ReplyPlatform, records: ThreadRecord[], claims: Claims): ImportedReply[] {
  return records
    .filter(r => r.depth === 0 && r.watch_comment_id !== r.root_comment_id && (r.reply_text ?? "").trim())
    .map(r => ({
      platform, parentCommentId: r.root_comment_id, commentText: r.original_text || null, commentAuthor: null, postId: null,
      replyId: r.watch_comment_id, replyText: r.reply_text as string, createdAt: r.created_at,
      source: claims.has(r.root_comment_id) && !claims.get(r.root_comment_id) ? "ai" : "rule",
    }));
}

async function seedFromRecords(ch: Channel, st: HistoryState, platform: "instagram" | "facebook"): Promise<void> {
  let seeded = 0;
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db().from("wa_comment_threads")
      .select("watch_comment_id,root_comment_id,original_text,reply_text,depth,created_at")
      .eq("tenant_id", ch.tenantId).eq("channel_id", ch.id).eq("platform", platform === "facebook" ? "messenger" : "instagram")
      .eq("depth", 0).gte("created_at", st.since).order("created_at", { ascending: true }).range(from, from + 999);
    if (error) { st.error = error.message; break; }
    const records = (data ?? []) as ThreadRecord[];
    const roots = records.filter(r => r.watch_comment_id !== r.root_comment_id).map(r => r.root_comment_id);
    seeded += await importCommentReplies(ch.tenantId, ch.id, repliesFromRecords(platform, records, await claimsFor(platform, ch.tenantId, roots)));
    if (records.length < 1000) break;
  }
  st.seeded = seeded;
  st.imported += seeded;
}

// ── The import, one bounded step per account ────────────────────────────────

const CLAIM_TABLE: Record<ReplyPlatform, string> = { youtube: "wa_yt_comment_log", instagram: "wa_ig_comment_log", facebook: "wa_fb_comment_log" };

async function claimsFor(platform: ReplyPlatform, tenantId: string, ids: string[]): Promise<Claims> {
  const claims: Claims = new Map();
  for (let i = 0; i < ids.length; i += 150) {
    const { data } = await db().from(CLAIM_TABLE[platform]).select("comment_id,rule_id").eq("tenant_id", tenantId).in("comment_id", ids.slice(i, i + 150));
    for (const r of (data ?? []) as { comment_id: string; rule_id: string | null }[]) claims.set(r.comment_id, r.rule_id ?? null);
  }
  return claims;
}

async function stepYoutube(ch: Channel, st: HistoryState): Promise<void> {
  if (!ch.ytChannelId) { st.done = true; st.error = "No YouTube channel id on this account."; return; }
  const creds = { channelId: ch.ytChannelId, refreshToken: ch.token };
  const since = Date.parse(st.since);
  let calls = 0;
  while (calls < CALLS_PER_ACCOUNT && !st.done) {
    const page = await listThreadsPage(creds, st.cursor, 3);
    calls += Math.max(1, page.calls);
    if (page.error) { failed(st, page.error); return; }
    st.failures = 0;
    const others = page.threads.flatMap(t => [t.top, ...t.replies]).filter(c => c.authorChannelId !== ch.ytChannelId).map(c => c.id);
    st.imported += await importCommentReplies(ch.tenantId, ch.id, ytRepliesFromThreads(page.threads, ch.ytChannelId, since, await claimsFor("youtube", ch.tenantId, others)));
    st.cursor = page.next;
    const oldest = page.threads[page.threads.length - 1]?.top.publishedAt;
    // Threads come newest first by their opening comment; past the window, stop.
    if (!page.next || (oldest && Date.parse(oldest) < since)) st.done = true;
  }
}

async function stepPosts(ch: Channel, st: HistoryState, platform: "instagram" | "facebook"): Promise<void> {
  const ig = platform === "instagram";
  const ownId = ig ? ch.igUserId : ch.pageId;
  if (!ownId) { st.done = true; st.error = `No ${ig ? "Instagram account" : "Facebook Page"} id on this account.`; return; }
  const igCreds = { igUserId: ch.igUserId ?? "", token: ch.token };
  const fbCreds = { pageId: ch.pageId ?? "", token: ch.token };
  const since = Date.parse(st.since);
  let calls = 0;
  const budget = ig ? IG_CALLS_PER_ACCOUNT : CALLS_PER_ACCOUNT;
  // First run: everything the app itself recorded, at once — no platform calls.
  if (st.seeded === undefined) await seedFromRecords(ch, st, platform);
  if (ig && st.selfIds === undefined) {
    const me = await getIgSelf(igCreds);
    calls++;
    st.selfName = me.username;
    st.selfIds = [...new Set([ownId, ...me.ids])];
  }
  st.queue ??= [];
  while (calls < budget && !st.done) {
    if (!st.queue.length) {
      if (st.listDone) { st.done = true; break; }
      const page = ig
        ? await listIgMediaPage(igCreds, st.cursor).then(p => ({ items: p.media.map(m => ({ id: m.id, at: m.timestamp })), next: p.next, error: p.error }))
        : await listFbPostsPage(fbCreds, st.cursor).then(p => ({ items: p.posts.map(m => ({ id: m.id, at: m.createdTime })), next: p.next, error: p.error }));
      calls++;
      if (page.error) { failed(st, page.error); return; }
      st.failures = 0;
      const fresh = page.items.filter(m => Date.parse(m.at) >= since);
      st.queue = fresh.map(m => ({ id: m.id, after: null }));
      st.cursor = page.next;
      // Posts come newest first; once one is older than the window, the rest are too.
      if (!page.next || fresh.length < page.items.length) st.listDone = true;
      continue;
    }
    const item = st.queue[0];
    calls++;
    if (ig) {
      const page = await listIgCommentsPage(igCreds, item.id, item.after);
      if (page.error) {
        if (AUTH_ERROR.test(page.error)) { failed(st, page.error); return; }
        st.error = page.error; st.queue.shift(); continue;   // a removed post: move on
      }
      // The nested replies only say a comment HAS replies; read their authors.
      for (const c of page.comments) {
        if (!c.replies.length) continue;
        const full = await listIgReplies(igCreds, c.id);
        calls++;
        if (!full.error) c.replies = full.replies;
        else st.seen = { ...(st.seen ?? { comments: 0, replies: 0, repliesWithName: 0, repliesWithId: 0, ours: 0 }), repliesError: full.error.slice(0, 200) };
      }
      const ids = page.comments.flatMap(c => [c.id, ...c.replies.map(r => r.id)]);
      const rows = igRepliesFromComments(page.comments, st.selfIds ?? [ownId], st.selfName ?? null, item.id, since, await claimsFor("instagram", ch.tenantId, ids));
      const replies = page.comments.flatMap(c => c.replies);
      const seen = st.seen ?? { comments: 0, replies: 0, repliesWithName: 0, repliesWithId: 0, ours: 0 };
      st.seen = { ...seen, comments: seen.comments + page.comments.length, commentsWithName: (seen.commentsWithName ?? 0) + page.comments.filter(c => c.username || c.fromId).length, replies: seen.replies + replies.length, repliesWithName: seen.repliesWithName + replies.filter(r => r.username).length, repliesWithId: seen.repliesWithId + replies.filter(r => r.fromId).length, ours: seen.ours + rows.length };
      st.imported += await importCommentReplies(ch.tenantId, ch.id, rows);
      if (page.next) item.after = page.next; else st.queue.shift();
    } else {
      const page = await listFbCommentsPage(fbCreds, item.id, item.after);
      if (page.error) {
        if (AUTH_ERROR.test(page.error)) { failed(st, page.error); return; }
        st.error = page.error; st.queue.shift(); continue;
      }
      const ids = page.comments.flatMap(c => [c.id, ...c.replies.map(r => r.id)]);
      st.imported += await importCommentReplies(ch.tenantId, ch.id, fbRepliesFromComments(page.comments, ownId, item.id, since, await claimsFor("facebook", ch.tenantId, ids)));
      if (page.next) item.after = page.next; else st.queue.shift();
    }
  }
}

/** Background engine: move the history import along for a few accounts. */
export async function drainReplyHistory(deadlineAt: number): Promise<{ accounts: number; imported: number }> {
  const channels = (await listChannels()).filter(c => isLiveChannel(c) && PLATFORM_OF[c.kind]);
  if (!channels.length) return { accounts: 0, imported: 0 };
  const { data } = await db().from("wa_settings").select("key,value").like("key", `${PREFIX}%`);
  const states = new Map(((data ?? []) as { key: string; value: HistoryState }[]).map(r => [r.key.slice(PREFIX.length), r.value]));
  let accounts = 0, imported = 0;
  for (const ch of channels) {
    if (accounts >= ACCOUNTS_PER_TICK || Date.now() > deadlineAt - 15_000) break;
    let st = states.get(ch.id) ?? freshState();
    // Read again with the current matching (Instagram's v1 recognised none of the account's own replies).
    if ((ch.kind === "instagram" || ch.kind === "messenger") && (st.v ?? 1) < VERSION) st = freshState();
    if (st.done) continue;
    const before = st.imported;
    try {
      if (ch.kind === "youtube") await stepYoutube(ch, st);
      else await stepPosts(ch, st, ch.kind === "instagram" ? "instagram" : "facebook");
    } catch (e) {
      st.error = e instanceof Error ? e.message : "History import failed";
    }
    if (st.done) st.finishedAt = new Date().toISOString();
    await setTenantSetting(ch.tenantId, `${PREFIX}${ch.id}`, st);
    accounts++; imported += st.imported - before;
  }
  return { accounts, imported };
}

// ── Who commented, for replies recorded without it ──────────────────────────
// Replies imported from the app's own thread records carry no commenter, and
// nothing before 2026-11-01 kept the commenter's id. Each tick fills a few,
// newest first (the ones on screen):
//  1. from Live Chat — every comment the automation acted on was stored there
//     as "[comment] <text>" in the commenter's conversation, moments before the
//     reply, under their platform id and @handle; no platform call needed;
//  2. otherwise by asking Instagram/Facebook who wrote that one comment.
// A row that can't be resolved is marked "" so it isn't asked about again.
const FILL_PER_TICK = 40;
const FILL_WINDOW_BEFORE_MS = 30 * 60_000;   // the comment arrives before our reply…
const FILL_WINDOW_AFTER_MS = 2 * 60_000;     // …give or take clock skew between the two writes

type FillRow = { id: string; tenant_id: string; channel_id: string | null; platform: ReplyPlatform; parent_comment_id: string; comment_text: string | null; comment_author: string | null; created_at: string };

async function fromLiveChat(row: FillRow): Promise<{ id: string; name: string | null } | null> {
  if (!row.comment_text || !row.channel_id) return null;
  const at = Date.parse(row.created_at);
  const { data } = await db().from("wa_conv_messages").select("conversation_id")
    .eq("tenant_id", row.tenant_id).eq("channel_id", row.channel_id).eq("role", "user").eq("body", `[comment] ${row.comment_text}`)
    .gte("created_at", new Date(at - FILL_WINDOW_BEFORE_MS).toISOString()).lte("created_at", new Date(at + FILL_WINDOW_AFTER_MS).toISOString())
    .order("created_at", { ascending: false }).limit(1);
  const convId = (data as { conversation_id: string }[] | null)?.[0]?.conversation_id;
  if (!convId) return null;
  const { data: conv } = await db().from("wa_conversations").select("phone,name").eq("id", convId).eq("tenant_id", row.tenant_id).maybeSingle();
  const c = conv as { phone: string; name: string | null } | null;
  return c?.phone ? { id: c.phone, name: c.name } : null;
}

async function fromPlatform(row: FillRow, ch: Channel | undefined): Promise<{ id: string; name: string | null } | null> {
  if (!ch || ch.tenantId !== row.tenant_id || !isLiveChannel(ch)) return null;
  if (row.platform === "instagram") {
    const a = await getIgCommentAuthor({ igUserId: ch.igUserId ?? "", token: ch.token }, row.parent_comment_id);
    return a.id ? { id: a.id, name: a.username ? `@${a.username}` : null } : null;
  }
  const a = await getFbCommentAuthor({ pageId: ch.pageId ?? "", token: ch.token }, row.parent_comment_id);
  return a.id ? { id: a.id, name: a.name } : null;
}

/** Background engine: name the commenter on a few replies recorded without one. */
export async function fillReplyAuthors(deadlineAt: number, max = FILL_PER_TICK): Promise<{ filled: number; looked: number }> {
  const { data, error } = await db().from("wa_comment_replies")
    .select("id,tenant_id,channel_id,platform,parent_comment_id,comment_text,comment_author,created_at")
    .is("comment_author_id", null).in("platform", ["instagram", "facebook"])
    .order("created_at", { ascending: false }).limit(max);
  // No comment_author_id column yet (migration 20261101230000): nothing to fill.
  if (error || !data?.length) return { filled: 0, looked: 0 };
  const channels = new Map((await listChannels()).map(c => [c.id, c]));
  let filled = 0, looked = 0;
  for (const row of data as FillRow[]) {
    if (Date.now() > deadlineAt - 5_000) break;
    looked++;
    const who = (await fromLiveChat(row)) ?? (await fromPlatform(row, row.channel_id ? channels.get(row.channel_id) : undefined));
    await db().from("wa_comment_replies").update({
      comment_author_id: who?.id ?? "",
      ...(who?.name && !row.comment_author ? { comment_author: who.name.slice(0, 200) } : {}),
    }).eq("id", row.id).eq("tenant_id", row.tenant_id);
    if (who) filled++;
  }
  return { filled, looked };
}

/** For the section's status line: is history still coming in for this platform? */
export async function historyStatus(tenantId: string, platform: ReplyPlatform): Promise<{ importing: boolean; imported: number; error: string | null }> {
  const mine = (await listChannels(tenantId)).filter(c => isLiveChannel(c) && PLATFORM_OF[c.kind] === platform);
  if (!mine.length) return { importing: false, imported: 0, error: null };
  const { data } = await db().from("wa_settings").select("key,value").eq("tenant_id", tenantId).in("key", mine.map(c => `${PREFIX}${c.id}`));
  const states = ((data ?? []) as { value: HistoryState }[]).map(r => r.value);
  return {
    importing: states.length < mine.length || states.some(s => !s.done),
    imported: states.reduce((n, s) => n + (s.imported ?? 0), 0),
    error: states.find(s => s.error)?.error ?? null,
  };
}
