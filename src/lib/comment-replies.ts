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
  replyId: string; replyText: string; source: ReplySource; status: "sent" | "edited" | "deleted";
  editedAt: string | null; editedBy: string | null; createdAt: string;
}

const TABLE = "wa_comment_replies";
export const SETUP_HINT = "The reply log isn't set up in the database yet. Apply migration 20261101120000_comment_replies.sql in Supabase, then reload.";
const missingTable = (msg: string) => /wa_comment_replies|schema cache|does not exist/i.test(msg);

function map(r: Record<string, unknown>): CommentReply {
  return {
    id: r.id as string, channelId: (r.channel_id as string | null) ?? null, platform: r.platform as ReplyPlatform,
    parentCommentId: r.parent_comment_id as string, commentText: (r.comment_text as string | null) ?? null,
    commentAuthor: (r.comment_author as string | null) ?? null, postId: (r.post_id as string | null) ?? null,
    replyId: r.reply_id as string, replyText: r.reply_text as string, source: r.source as ReplySource,
    status: r.status as CommentReply["status"], editedAt: (r.edited_at as string | null) ?? null,
    editedBy: (r.edited_by as string | null) ?? null, createdAt: r.created_at as string,
  };
}

/** Note a public reply that was just posted. Never throws. */
export async function recordCommentReply(r: {
  tenantId: string; channelId: string | null; platform: ReplyPlatform;
  parentCommentId: string; replyId: string | null | undefined; replyText: string;
  source: ReplySource; commentText?: string | null; commentAuthor?: string | null; postId?: string | null;
}): Promise<void> {
  if (!r.tenantId || !r.replyId || !r.parentCommentId || !r.replyText?.trim()) return;
  try {
    const { error } = await tdb(r.tenantId).from(TABLE).upsert({
      channel_id: r.channelId, platform: r.platform, parent_comment_id: r.parentCommentId,
      comment_text: r.commentText?.slice(0, 4000) ?? null, comment_author: r.commentAuthor?.slice(0, 200) || null,
      post_id: r.postId ?? null, reply_id: r.replyId, reply_text: r.replyText.slice(0, 9000), source: r.source,
    }, { onConflict: "platform,reply_id", ignoreDuplicates: true });
    if (error) console.warn("[comment-replies] record failed:", error.message);
  } catch (e) {
    console.warn("[comment-replies] record failed:", errorMessage(e));
  }
}

export async function listCommentReplies(tenantId: string, q: { platform: ReplyPlatform; channelId?: string | null; before?: string | null; limit?: number }): Promise<{ replies: CommentReply[]; setupNeeded?: string }> {
  const limit = Math.min(Math.max(q.limit ?? 30, 1), 100);
  let query = tdb(tenantId).from(TABLE).select("*").eq("platform", q.platform).order("created_at", { ascending: false }).limit(limit);
  if (q.channelId) query = query.eq("channel_id", q.channelId);
  if (q.before) query = query.lt("created_at", q.before);
  const { data, error } = await query;
  if (error) {
    if (missingTable(error.message)) return { replies: [], setupNeeded: SETUP_HINT };
    throw new Error(error.message);
  }
  return { replies: ((data ?? []) as unknown as Record<string, unknown>[]).map(map) };
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
