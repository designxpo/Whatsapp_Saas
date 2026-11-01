// Every public comment reply the product posts on YouTube, Instagram and
// Facebook, kept so the team can read them and correct a wrong one.
//
// A row is written wherever a public reply succeeds: the AI's answer, a rule's
// canned reply, an AI follow-up in a thread. Recording is best-effort and never
// throws: a reply that reached the customer must not fail because the log did.
//
// Correcting a reply goes back to the platform:
//  - YouTube and Facebook edit the comment in place;
//  - Instagram cannot edit a comment at all, so the corrected reply is posted
//    first (the customer gets the right answer even if the next step fails) and
//    the wrong one is then deleted. The row points at the new reply.

import { tdb } from "./tenantdb";
import { getChannelById, type Channel } from "./channels";
import { editComment as editYtComment, deleteComment as deleteYtComment, type YtCreds } from "./youtube";
import { editFbComment, deleteFbComment, type FbCreds } from "./messenger";
import { replyToComment as replyToIgComment, deleteIgComment, type IgCreds } from "./instagram";
import { errorMessage } from "./errors";

export type ReplyPlatform = "youtube" | "instagram" | "facebook";
export type ReplySource = "ai" | "rule" | "ai_followup" | "manual";
export const REPLY_PLATFORMS: ReplyPlatform[] = ["youtube", "instagram", "facebook"];

export interface CommentReply {
  id: string; channelId: string | null; platform: ReplyPlatform;
  parentCommentId: string; commentText: string | null; commentAuthor: string | null; postId: string | null;
  /** The commenter's platform id: Instagram-scoped id, Facebook page-scoped id or YouTube channel id. */
  commentAuthorId: string | null;
  replyId: string; replyText: string; source: ReplySource; status: "sent" | "edited" | "deleted";
  editedAt: string | null; editedBy: string | null; createdAt: string;
  /** What the workspace already knows about the commenter (their chat), when it does. */
  person?: CommentPerson;
}

export interface CommentPerson {
  /** Their chat's id in Live Chat (the platform id the conversation is keyed by). */
  chatPhone: string; name: string | null; avatarUrl: string | null;
  /** A phone number they shared in the chat, if any. */
  leadPhone: string | null;
}

const TABLE = "wa_comment_replies";
export const SETUP_HINT = "The reply log isn't set up in the database yet. Apply migration 20261101120000_comment_replies.sql in Supabase, then reload.";
const missingTable = (msg: string) => /wa_comment_replies|schema cache|does not exist/i.test(msg);

function map(r: Record<string, unknown>): CommentReply {
  return {
    id: r.id as string, channelId: (r.channel_id as string | null) ?? null, platform: r.platform as ReplyPlatform,
    parentCommentId: r.parent_comment_id as string, commentText: (r.comment_text as string | null) ?? null,
    commentAuthor: (r.comment_author as string | null) ?? null, postId: (r.post_id as string | null) ?? null,
    commentAuthorId: (r.comment_author_id as string | null) || null,
    replyId: r.reply_id as string, replyText: r.reply_text as string, source: r.source as ReplySource,
    status: r.status as CommentReply["status"], editedAt: (r.edited_at as string | null) ?? null,
    editedBy: (r.edited_by as string | null) ?? null, createdAt: r.created_at as string,
  };
}

/** Note a public reply that was just posted. Never throws. */
export async function recordCommentReply(r: {
  tenantId: string; channelId: string | null; platform: ReplyPlatform;
  parentCommentId: string; replyId: string | null | undefined; replyText: string;
  source: ReplySource; commentText?: string | null; commentAuthor?: string | null; commentAuthorId?: string | null; postId?: string | null;
}): Promise<void> {
  if (!r.tenantId || !r.replyId || !r.parentCommentId || !r.replyText?.trim()) return;
  try {
    const { error } = await upsertRows(r.tenantId, [{
      channel_id: r.channelId, platform: r.platform, parent_comment_id: r.parentCommentId,
      comment_text: r.commentText?.slice(0, 4000) ?? null, comment_author: r.commentAuthor?.slice(0, 200) || null,
      comment_author_id: r.commentAuthorId?.slice(0, 100) || null,
      post_id: r.postId ?? null, reply_id: r.replyId, reply_text: r.replyText.slice(0, 9000), source: r.source,
    }]);
    if (error) console.warn("[comment-replies] record failed:", error.message);
  } catch (e) {
    console.warn("[comment-replies] record failed:", errorMessage(e));
  }
}

/** A past reply found on the platform (comment-history.ts), with its own posting time. */
export interface ImportedReply {
  platform: ReplyPlatform; parentCommentId: string; commentText: string | null; commentAuthor: string | null;
  commentAuthorId?: string | null;
  postId: string | null; replyId: string; replyText: string; source: ReplySource; createdAt: string;
}

// Before migration 20261101230000 there is no comment_author_id column: write
// without it rather than lose the row.
const noAuthorIdColumn = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === "PGRST204" || e.code === "42703") && /comment_author_id/.test(e.message ?? "");

async function upsertRows(tenantId: string, rows: Record<string, unknown>[], select = false) {
  const run = (rs: Record<string, unknown>[]) => {
    const q = tdb(tenantId).from(TABLE).upsert(rs, { onConflict: "platform,reply_id", ignoreDuplicates: true });
    return select ? q.select("id") : q;
  };
  const first = await run(rows);
  if (!noAuthorIdColumn(first.error)) return first;
  return run(rows.map(({ comment_author_id: _drop, ...rest }) => rest));
}

/** Add past replies; ones already in the log are left as they are. Returns how many were new. */
export async function importCommentReplies(tenantId: string, channelId: string, rows: ImportedReply[]): Promise<number> {
  const clean = rows.filter(r => r.replyId && r.parentCommentId && r.replyText?.trim() && !Number.isNaN(Date.parse(r.createdAt)));
  if (!clean.length) return 0;
  const { data, error } = await upsertRows(tenantId, clean.map(r => ({
    channel_id: channelId, platform: r.platform, parent_comment_id: r.parentCommentId,
    comment_text: r.commentText?.slice(0, 4000) ?? null, comment_author: r.commentAuthor?.slice(0, 200) || null,
    comment_author_id: r.commentAuthorId?.slice(0, 100) || null,
    post_id: r.postId, reply_id: r.replyId, reply_text: r.replyText.slice(0, 9000), source: r.source, created_at: r.createdAt,
  })), true);
  if (error) throw new Error(error.message);
  return (data ?? []).length;
}

export const RANGES = [7, 30, 90, 365] as const;
const PAGE = 25;

/** "<created_at>|<id>": where the next page starts. Ties on time are broken by id, so nothing is skipped. */
function parseCursor(c: string | null | undefined): { at: string; id: string } | null {
  const [at, id] = (c ?? "").split("|");
  return at && id && !Number.isNaN(Date.parse(at)) && /^[0-9a-f-]{36}$/i.test(id) ? { at, id } : null;
}

// Live Chat keeps each commenter's conversation under their platform id, with
// their @handle, picture and any phone they shared — the "who is this" the
// reply card shows. Matched by id, or for older Instagram rows by @handle.
const CHAT_PLATFORM: Record<ReplyPlatform, string> = { instagram: "instagram", facebook: "messenger", youtube: "youtube" };
export async function withPeople(tenantId: string, platform: ReplyPlatform, replies: CommentReply[]): Promise<CommentReply[]> {
  const ids = [...new Set(replies.map(r => r.commentAuthorId).filter((x): x is string => !!x))];
  const handles = platform === "instagram" ? [...new Set(replies.filter(r => !r.commentAuthorId && r.commentAuthor?.startsWith("@")).map(r => r.commentAuthor as string))] : [];
  if (!ids.length && !handles.length) return replies;
  type Conv = { phone: string; name: string | null; avatar_url: string | null; lead_phone: string | null; channel_id: string | null };
  const found: Conv[] = [];
  const cols = "phone,name,avatar_url,lead_phone,channel_id";
  if (ids.length) {
    const { data } = await tdb(tenantId).from("wa_conversations").select(cols).eq("platform", CHAT_PLATFORM[platform]).in("phone", ids);
    found.push(...((data ?? []) as unknown as Conv[]));
  }
  if (handles.length) {
    const { data } = await tdb(tenantId).from("wa_conversations").select(cols).eq("platform", CHAT_PLATFORM[platform]).in("name", handles);
    found.push(...((data ?? []) as unknown as Conv[]));
  }
  const pick = (r: CommentReply) => {
    const same = found.filter(c => r.commentAuthorId ? c.phone === r.commentAuthorId : c.name === r.commentAuthor);
    return same.find(c => c.channel_id === r.channelId) ?? same[0];
  };
  return replies.map(r => {
    const c = pick(r);
    return c ? { ...r, commentAuthorId: r.commentAuthorId ?? c.phone, person: { chatPhone: c.phone, name: c.name, avatarUrl: c.avatar_url, leadPhone: c.lead_phone } } : r;
  });
}

/**
 * One page (25) of a platform's replies within the last `days`, newest first.
 * Keyset paging on (created_at, id) — every page costs the same however deep —
 * and the total is counted only for the first page.
 */
export async function listCommentReplies(tenantId: string, q: { platform: ReplyPlatform; channelId?: string | null; days?: number | null; cursor?: string | null }): Promise<{ replies: CommentReply[]; next: string | null; total?: number; setupNeeded?: string }> {
  const days = RANGES.includes(q.days as never) ? q.days! : 30;
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const at = parseCursor(q.cursor);
  let query = tdb(tenantId).from(TABLE).select("*").eq("platform", q.platform).gte("created_at", since)
    .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(PAGE + 1);
  if (q.channelId) query = query.eq("channel_id", q.channelId);
  if (at) query = query.or(`created_at.lt."${at.at}",and(created_at.eq."${at.at}",id.lt.${at.id})`);
  const { data, error } = await query;
  if (error) {
    if (missingTable(error.message)) return { replies: [], next: null, setupNeeded: SETUP_HINT };
    throw new Error(error.message);
  }
  const rows = ((data ?? []) as unknown as Record<string, unknown>[]).map(map);
  const replies = await withPeople(tenantId, q.platform, rows.slice(0, PAGE));
  const last = replies[replies.length - 1];
  const next = rows.length > PAGE && last ? `${last.createdAt}|${last.id}` : null;
  if (at) return { replies, next };
  let count = tdb(tenantId).from(TABLE).select("id", { count: "exact", head: true }).eq("platform", q.platform).gte("created_at", since);
  if (q.channelId) count = count.eq("channel_id", q.channelId);
  const { count: total } = await count;
  return { replies, next, total: total ?? replies.length };
}

async function load(tenantId: string, id: string): Promise<{ row?: CommentReply; channel?: Channel; error?: string }> {
  const { data, error } = await tdb(tenantId).from(TABLE).select("*").eq("id", id).maybeSingle();
  if (error) return { error: missingTable(error.message) ? SETUP_HINT : error.message };
  if (!data) return { error: "That reply isn't in this workspace." };
  const row = map(data as unknown as Record<string, unknown>);
  if (row.status === "deleted") return { error: "That reply was deleted." };
  const channel = row.channelId ? await getChannelById(row.channelId) : null;
  if (!channel || channel.tenantId !== tenantId) return { error: "This account is no longer connected, so the reply can't be changed from here." };
  return { row, channel };
}

const ytCreds = (c: Channel): YtCreds => ({ channelId: c.ytChannelId ?? "", refreshToken: c.token });
const fbCreds = (c: Channel): FbCreds => ({ pageId: c.pageId ?? "", token: c.token });
const igCreds = (c: Channel): IgCreds => ({ igUserId: c.igUserId ?? "", token: c.token });

/**
 * Put corrected text up in place of a reply. `warning` is set when the
 * correction is live but something around it didn't finish (Instagram: the old
 * reply couldn't be removed).
 */
export async function editCommentReply(tenantId: string, id: string, text: string, actor: string): Promise<{ reply?: CommentReply; error?: string; warning?: string }> {
  const clean = text.trim();
  if (!clean) return { error: "Write the corrected reply first." };
  const { row, channel, error } = await load(tenantId, id);
  if (!row || !channel) return { error };
  if (clean === row.replyText) return { reply: row };

  let replyId = row.replyId;
  let warning: string | undefined;
  if (row.platform === "youtube") {
    const r = await editYtComment(ytCreds(channel), row.replyId, clean, tenantId);
    if (!r.ok) return { error: `YouTube didn't accept the change: ${r.error}` };
  } else if (row.platform === "facebook") {
    const r = await editFbComment(fbCreds(channel), row.replyId, clean, tenantId);
    if (!r.ok) return { error: `Facebook didn't accept the change: ${r.error}` };
  } else {
    // New reply first: the customer gets the right answer even if removing the old one fails.
    const posted = await replyToIgComment(igCreds(channel), row.parentCommentId, clean, tenantId);
    if (!posted.ok || !posted.id) return { error: `Instagram didn't accept the corrected reply: ${posted.error ?? "no reply id returned"}` };
    replyId = posted.id;
    const removed = await deleteIgComment(igCreds(channel), row.replyId);
    if (!removed.ok) warning = `Your corrected reply is up, but Instagram didn't remove the old one (${removed.error}). Delete it in the Instagram app.`;
  }

  const patch = { reply_id: replyId, reply_text: clean, status: "edited", edited_at: new Date().toISOString(), edited_by: actor };
  const { data, error: upErr } = await tdb(tenantId).from(TABLE).update(patch).eq("id", id).select("*").maybeSingle();
  if (upErr) return { error: `The reply changed on ${row.platform}, but the log couldn't be updated: ${upErr.message}`, warning };
  return { reply: data ? map(data as Record<string, unknown>) : { ...row, replyId, replyText: clean, status: "edited" }, warning };
}

/** Take a reply down from the platform. */
export async function deleteCommentReply(tenantId: string, id: string, actor: string): Promise<{ error?: string }> {
  const { row, channel, error } = await load(tenantId, id);
  if (!row || !channel) return { error };
  const r = row.platform === "youtube" ? await deleteYtComment(ytCreds(channel), row.replyId)
    : row.platform === "facebook" ? await deleteFbComment(fbCreds(channel), row.replyId)
    : await deleteIgComment(igCreds(channel), row.replyId);
  if (!r.ok) return { error: `The reply couldn't be deleted: ${r.error}` };
  await tdb(tenantId).from(TABLE).update({ status: "deleted", edited_at: new Date().toISOString(), edited_by: actor }).eq("id", id);
  return {};
}
