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
import { matchYtCommentRule, claimYtComment, bumpYtRuleMatch, getYtDailyReplyCap, ytActionsUsedToday } from "./ytcomments";
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

async function drainChannel(channel: Channel, aiEnabledCache: Map<string, boolean>, budgetCache: Map<string, number>, capCache: Map<string, number>): Promise<number> {
  const creds: YtCreds = { channelId: channel.ytChannelId as string, refreshToken: channel.token };
  if (!creds.channelId || !creds.refreshToken) return 0;

  const since = await getCursor(channel.id);
  // First poll (no cursor): this is the moment automation goes live for this
  // channel. Set the watermark to NOW and reply to NOTHING. Auto-replies must
  // only ever fire on comments posted AFTER activation — never the existing
  // backlog, however recent its newest comment is. (listNewComments only
  // time-filters when `since` is set; with since=null it returns the most-recent
  // existing comments, so without this guard the first poll replies to months-old
  // comments the instant a channel connects.)
  if (!since) {
    await setCursor(channel.id, channel.tenantId, new Date().toISOString(), { commentsSeen: 0, repliesPosted: 0 });
    return 0;
  }

  const comments = await listNewComments(creds, since, 3);
  if (!comments.length) {
    await setCursor(channel.id, channel.tenantId, new Date().toISOString(), { commentsSeen: 0, repliesPosted: 0 });
    return 0;
  }

  let acted = 0;
  let lastReplyId: string | null = null;
  let lastError: string | null = null;
  let aiEnabled = aiEnabledCache.get(channel.tenantId);
  if (aiEnabled === undefined) { aiEnabled = await isAiEnabled(channel.tenantId); aiEnabledCache.set(channel.tenantId, aiEnabled); }

  // Per-tenant daily reply budget: how many more quota-consuming comment actions
  // this tenant may take today. The cap is PLAN-AWARE (getYtDailyReplyCap — higher
  // tiers raise it), shared across the tenant's channels within this run, and
  // decremented as we act. Infinity when the cap is disabled platform-wide.
  let cap = capCache.get(channel.tenantId);
  let budget = budgetCache.get(channel.tenantId);
  if (cap === undefined || budget === undefined) {
    cap = await getYtDailyReplyCap(channel.tenantId);
    budget = cap > 0 ? Math.max(0, cap - (await ytActionsUsedToday(channel.tenantId))) : Number.POSITIVE_INFINITY;
    capCache.set(channel.tenantId, cap);
    budgetCache.set(channel.tenantId, budget);
  }

  // Oldest → newest so the cursor advances monotonically even if we stop early.
  const ordered = [...comments].reverse();
  // Advance the cursor only THROUGH comments we've fully handled. When the daily
  // cap stops us mid-run, we leave the cursor at the last handled comment so the
  // deferred backlog is answered next tick (or after 00:00 UTC when the cap
  // resets) — never silently skipped past.
  let cursorAt = since.toISOString();
  let capReached = false;
  for (const c of ordered) {
    // Never reply to our own channel's comments (no self-loop) — nothing to do,
    // so it's "handled": advance past it.
    if (c.authorChannelId && c.authorChannelId === channel.ytChannelId) { if (c.publishedAt) cursorAt = c.publishedAt; continue; }

    const rule = await matchYtCommentRule(c.text, c.videoId, channel.tenantId, channel.id);
    const aiWillAnswer = !rule && channel.commentAi && aiEnabled;
    // Take no action → do NOT claim, but DO advance. Claiming here used to burn the
    // comment id permanently, so a rule created afterwards could never fire on a
    // comment the poller had already walked past with nothing to do.
    if (!rule && !aiWillAnswer) { if (c.publishedAt) cursorAt = c.publishedAt; continue; }

    // A quota-consuming action is due. Out of daily budget → STOP here, leaving
    // this comment and every later one for a future tick (cursor stays before it).
    if (budget <= 0) { capReached = true; break; }

    // Idempotency: claim the comment once (whether a rule fires or the AI answers).
    // Already claimed (a prior run) → nothing more to do, advance past it.
    if (!(await claimYtComment(c.id, rule?.id ?? null, channel.tenantId))) { if (c.publishedAt) cursorAt = c.publishedAt; continue; }
    budget -= 1;   // one comment-action spent against the tenant's daily cap

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
      if (c.publishedAt) cursorAt = c.publishedAt;
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
    if (c.publishedAt) cursorAt = c.publishedAt;
  }

  budgetCache.set(channel.tenantId, budget < 0 ? 0 : budget);

  // Cursor: through the newest comment when we finished the batch, or only through
  // the last handled comment when the daily cap deferred the rest.
  let newestSeen = since.toISOString();
  for (const c of comments) if (c.publishedAt && c.publishedAt > newestSeen) newestSeen = c.publishedAt;
  const finalCursor = capReached ? cursorAt : newestSeen;
  if (capReached && !lastError) {
    lastError = `Daily reply cap reached (${cap}/day) — the rest will be answered automatically after midnight UTC.`;
  }

  await setCursor(channel.id, channel.tenantId, finalCursor || new Date().toISOString(), {
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
  // Per-tenant remaining daily reply budget + resolved cap, shared across a
  // tenant's channels for this run so they can't each spend the full cap
  // independently (and so one plan lookup serves all the tenant's channels).
  const budgetCache = new Map<string, number>();
  const capCache = new Map<string, number>();
  let acted = 0;
  for (const ch of channels) {
    try { acted += await drainChannel(ch, aiEnabledCache, budgetCache, capCache); }
    catch (e) { console.error("[ytpoller] channel", ch.id, e); }
  }
  return acted;
}
