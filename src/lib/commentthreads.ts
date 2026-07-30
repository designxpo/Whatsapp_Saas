// AI takeover of comment threads a rule opened (Instagram + Facebook).
// A rule fires its public reply → we "watch" the thread; a follow-up reply in
// that thread routes to the AI (contextual answer) instead of the canned rule.
//
// Tenancy: db() is service-role; every read filters by tenant_id, every write
// stamps it.

import { db } from "./supabase";

// Max AI turns per thread — a hard anti-runaway cap (a thread can't loop forever
// even though we never reply to our own comments).
export const MAX_AI_THREAD_DEPTH = 4;

export interface CommentWatch {
  tenantId: string;
  channelId: string | null;
  platform: string;             // "instagram" | "messenger"
  rootCommentId: string;        // where the AI posts its reply (top-level of the thread)
  originalText: string;         // the human's original comment (AI context)
  replyText: string;            // our last reply in the thread (AI context)
  depth: number;                // AI turns so far
}

// Mark one or more comment ids as "reply here → AI answers", all pointing at the
// same thread context. Best-effort; upsert so redeliveries don't error.
export async function trackCommentWatch(watchIds: (string | null | undefined)[], w: CommentWatch): Promise<void> {
  const rows = watchIds
    .filter((id): id is string => !!id)
    .map(id => ({
      watch_comment_id: id,
      tenant_id: w.tenantId,
      channel_id: w.channelId,
      platform: w.platform,
      root_comment_id: w.rootCommentId,
      original_text: (w.originalText || "").slice(0, 2000),
      reply_text: (w.replyText || "").slice(0, 2000),
      depth: w.depth,
    }));
  if (!rows.length) return;
  await db().from("wa_comment_threads").upsert(rows, { onConflict: "watch_comment_id" }).then(() => {}, () => {});
}

// Is a reply to `watchCommentId` a follow-up in a thread we opened? Returns the
// thread context (for the AI) or null.
export async function getCommentWatch(watchCommentId: string, tenantId: string): Promise<CommentWatch | null> {
  const { data } = await db().from("wa_comment_threads").select("*").eq("watch_comment_id", watchCommentId).eq("tenant_id", tenantId).maybeSingle();
  if (!data) return null;
  const d = data as Record<string, unknown>;
  return {
    tenantId,
    channelId: (d.channel_id as string | null) ?? null,
    platform: (d.platform as string) ?? "instagram",
    rootCommentId: (d.root_comment_id as string) ?? "",
    originalText: (d.original_text as string) ?? "",
    replyText: (d.reply_text as string) ?? "",
    depth: (d.depth as number) ?? 0,
  };
}
