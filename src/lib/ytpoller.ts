// YouTube comment poller (Module 1). YouTube has NO new-comment webhook, so the
// cron drains new comments per channel, applies the rule engine (rotating public
// reply + optional moderation), and — when the channel has "AI answers comments"
// on — lets the AI publicly answer un-ruled comments (persona + KB grounded).
//
// Quota-aware: only channels that are connected (refresh token present) and
// active are polled, and only comments newer than each channel's cursor are
// fetched. Everything no-ops safely when YouTube isn't configured (Phase 1a is
// dormant until the OAuth client is approved) or the tables don't exist yet.

import { db } from "./supabase";
import { listChannels, effectiveAgentId, effectiveKbTag, type Channel } from "./channels";
import { youtubeConfigured, listNewComments, replyToComment, setModeration, type YtCreds } from "./youtube";
import { matchYtCommentRule, claimYtComment, bumpYtRuleMatch } from "./ytcomments";
import { pickPublicReply } from "./igcomments";
import { generateReply } from "./llm";
import { isAiEnabled } from "./messaging-settings";

// Per-channel cursor (last successful poll time). Missing table / row → null so a
// first poll simply walks a bounded number of recent comments.
async function getCursor(channelId: string): Promise<Date | null> {
  try {
    const { data } = await db().from("wa_yt_poll_cursor").select("last_polled_at").eq("channel_id", channelId).maybeSingle();
    const v = (data as { last_polled_at?: string } | null)?.last_polled_at;
    return v ? new Date(v) : null;
  } catch { return null; }
}
// Diagnostics recorded alongside the cursor so the portal can explain what the
// last poll actually did. Extra columns land in 0097; the write is best-effort
// and column-by-column optional so a pre-0097 DB still advances the cursor.
interface PollOutcome { commentsSeen?: number; repliesPosted?: number; lastReplyId?: string | null; lastError?: string | null }
async function setCursor(channelId: string, tenantId: string, at: string, o?: PollOutcome): Promise<void> {
  const row: Record<string, unknown> = { channel_id: channelId, tenant_id: tenantId, last_polled_at: at, updated_at: at };
  if (o) {
    row.last_checked_at = at;
    row.comments_seen = o.commentsSeen ?? 0;
    row.replies_posted = o.repliesPosted ?? 0;
    row.last_error = o.lastError ?? null;
    if (o.lastReplyId) { row.last_reply_id = o.lastReplyId; row.last_reply_at = at; }
  }
  const write = (r: Record<string, unknown>) => db().from("wa_yt_poll_cursor").upsert(r, { onConflict: "channel_id" });
  const { error } = await write(row);
  // Pre-0097 DB: retry with just the cursor so polling never breaks on the
  // diagnostic columns being absent.
  if (error) await write({ channel_id: channelId, tenant_id: tenantId, last_polled_at: at, updated_at: at }).then(() => {}, () => {});
}

async function drainChannel(channel: Channel, aiEnabledCache: Map<string, boolean>): Promise<number> {
  const creds: YtCreds = { channelId: channel.ytChannelId as string, refreshToken: channel.token };
  if (!creds.channelId || !creds.refreshToken) return 0;

  const since = await getCursor(channel.id);
  // First poll (no cursor): only look at the most recent page so we don't reply
  // to a large backlog of historical comments the moment a channel connects.
  const comments = await listNewComments(creds, since, since ? 3 : 1);
  if (!comments.length) {
    await setCursor(channel.id, channel.tenantId, new Date().toISOString(), { commentsSeen: 0, repliesPosted: 0 });
    return 0;
  }

  let acted = 0;
  let lastReplyId: string | null = null;
  let lastError: string | null = null;
  let aiEnabled = aiEnabledCache.get(channel.tenantId);
  if (aiEnabled === undefined) { aiEnabled = await isAiEnabled(channel.tenantId); aiEnabledCache.set(channel.tenantId, aiEnabled); }

  // Oldest → newest so the cursor advances monotonically even if we stop early.
  const ordered = [...comments].reverse();
  let newestSeen = since?.toISOString() ?? "";
  for (const c of ordered) {
    if (c.publishedAt && c.publishedAt > newestSeen) newestSeen = c.publishedAt;
    // Never reply to our own channel's comments (no self-loop).
    if (c.authorChannelId && c.authorChannelId === channel.ytChannelId) continue;

    const rule = await matchYtCommentRule(c.text, c.videoId, channel.tenantId, channel.id);
    const aiWillAnswer = !rule && channel.commentAi && aiEnabled;
    // Take no action → do NOT claim. Claiming here used to burn the comment id
    // permanently, so a rule created afterwards could never fire on a comment
    // the poller had already walked past with nothing to do.
    if (!rule && !aiWillAnswer) continue;
    // Idempotency: claim the comment once (whether a rule fires or the AI answers).
    if (!(await claimYtComment(c.id, rule?.id ?? null, channel.tenantId))) continue;

    if (rule) {
      const reply = pickPublicReply({ publicReplies: rule.publicReplies, publicReply: null });
      if (reply) {
        const r = await replyToComment(creds, c.id, reply);
        if (r.ok) { acted++; lastReplyId = r.id ?? null; }
        else { lastError = r.error ?? "YouTube refused the reply"; console.error("[ytpoller] rule reply failed", channel.id, c.id, r.error); }
      }
      if (rule.moderate === "hold_spam") await setModeration(creds, c.id, "heldForReview");
      else if (rule.moderate === "reject_spam") await setModeration(creds, c.id, "rejected");
      await bumpYtRuleMatch(rule.id, rule.matchCount, channel.tenantId);
      continue;
    }

    // No rule matched → let the AI answer publicly, if the channel opts in and the
    // tenant's AI is on. Grounded in the channel's persona + KB.
    if (aiWillAnswer) {
      try {
        const res = await generateReply(
          [{ role: "user", body: c.text }],
          undefined,
          effectiveAgentId(null, channel),
          channel.tenantId,
          effectiveKbTag(null, channel),
          false,
        );
        if (res.reply && !res.escalate) {
          const r = await replyToComment(creds, c.id, res.reply);
          if (r.ok) { acted++; lastReplyId = r.id ?? null; }
          else { lastError = r.error ?? "YouTube refused the reply"; console.error("[ytpoller] ai reply failed", channel.id, c.id, r.error); }
        } else if (res.escalate) {
          lastError = "The AI declined to answer this comment (not enough in the knowledge base).";
        }
      } catch (e) {
        lastError = e instanceof Error ? e.message : "AI reply failed";
        console.error("[ytpoller] ai reply", c.id, e);
      }
    }
  }

  await setCursor(channel.id, channel.tenantId, newestSeen || new Date().toISOString(), {
    commentsSeen: comments.length, repliesPosted: acted, lastReplyId, lastError,
  });
  return acted;
}

// Cron entrypoint — poll every connected YouTube channel and act on new comments.
// Returns the number of replies/moderations performed this tick. Pass a
// tenantId to poll just that workspace (the portal's "Check now" button, so an
// admin testing a rule doesn't wait for the next 5-minute cron tick).
export async function drainYtComments(tenantId?: string): Promise<number> {
  if (!youtubeConfigured()) return 0;   // dormant until the OAuth client is set
  let channels: Channel[];
  try {
    channels = (await listChannels(tenantId)).filter(c => c.kind === "youtube" && c.active && c.ytChannelId && c.token);
  } catch { return 0; }
  if (!channels.length) return 0;
  const aiEnabledCache = new Map<string, boolean>();
  let acted = 0;
  for (const ch of channels) {
    try { acted += await drainChannel(ch, aiEnabledCache); }
    catch (e) { console.error("[ytpoller] channel", ch.id, e); }
  }
  return acted;
}
