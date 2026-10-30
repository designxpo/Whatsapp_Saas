// YouTube comment poller (Module 1). YouTube has NO new-comment webhook, so the
// cron drains new comments per channel, applies the rule engine (rotating public
// reply + optional moderation), and — when the channel has "AI answers comments"
// on — lets the AI publicly answer un-ruled comments (persona + KB grounded).
//
// Quota-aware: only channels that are connected (refresh token present) and
// active are polled, and only comments newer than each channel's cursor are
// fetched. Everything no-ops safely when YouTube isn't configured (Phase 1a is
// dormant until the OAuth client is approved) or the tables don't exist yet.

import { partnerYtRemaining } from "./partner-quotas";
import { db } from "./supabase";
import { listChannels, effectiveAgentId, effectiveKbScope, type Channel } from "./channels";
import { youtubeConfigured, listNewComments, replyToComment, setModeration, getThreads, getChannelHandle, type YtCreds } from "./youtube";
import {
  matchYtCommentRule, claimYtComment, claimedYtCommentIds, listYtCommentRules, bumpYtRuleMatch, getYtDailyReplyCap, ytActionsUsedToday,
  getYtWatch, saveYtWatch, recentlyAnsweredThreads, releaseYtComment,
} from "./ytcomments";
import { pickFollowUps, threadHistory, addressTo, watchDue, pruneWatch, classifyAiReply, WATCH_DAYS } from "./ytfollowups";
import { pickPublicReply } from "./igcomments";
import { generateReply, isCannedNonAnswer } from "./llm";
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
// `at` is the comment watermark (a comment's own publish time), not the clock —
// "last checked" is recorded separately as now.
async function setCursor(channelId: string, tenantId: string, at: string, o?: PollOutcome): Promise<void> {
  const now = new Date().toISOString();
  const row: Record<string, unknown> = { channel_id: channelId, tenant_id: tenantId, last_polled_at: at, updated_at: now };
  if (o) {
    row.last_checked_at = now;
    row.comments_seen = o.commentsSeen ?? 0;
    row.replies_posted = o.repliesPosted ?? 0;
    row.last_error = o.lastError ?? null;
    if (o.lastReplyId) { row.last_reply_id = o.lastReplyId; row.last_reply_at = now; }
  }
  const write = (r: Record<string, unknown>) => db().from("wa_yt_poll_cursor").upsert(r, { onConflict: "channel_id" });
  const { error } = await write(row);
  // Pre-0097 DB: retry with just the cursor so polling never breaks on the
  // diagnostic columns being absent.
  if (error) await write({ channel_id: channelId, tenant_id: tenantId, last_polled_at: at, updated_at: at }).then(() => {}, () => {});
}

/** How far behind the watermark each poll re-reads (see drainChannel). */
const LOOKBACK_MS = 24 * 3600_000;
/**
 * The later of two ISO times; a missing one never moves the watermark back.
 * Compared as instants, not strings: YouTube writes "…:01Z" and toISOString()
 * writes "…:01.000Z", which sort the wrong way round as text.
 */
const later = (a: string, b: string | null | undefined): string => (b && Date.parse(b) > Date.parse(a) ? b : a);

async function drainChannel(channel: Channel, aiEnabledCache: Map<string, boolean>, budgetCache: Map<string, number>, capCache: Map<string, number>, answered: string[], aiFailing: Set<string>): Promise<number> {
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

  // Re-read a window BEHIND the watermark, and never move the watermark to the
  // wall clock. A comment can reach the API after a later poll already ran:
  // YouTube's comment index lags by minutes, and a comment YouTube held for
  // review only appears once the owner approves it — both arrive carrying their
  // ORIGINAL publish time. With a "since = last poll time" cursor such a comment
  // was older than the cursor the moment it became visible, so it was skipped
  // forever. Already-handled comments in the window are filtered by the claim log.
  // The floor never reaches before the channel was connected, so connecting a
  // channel still never answers its existing backlog.
  const connectedAt = Date.parse(channel.createdAt ?? "") || 0;
  const floor = new Date(Math.max(since.getTime() - LOOKBACK_MS, connectedAt));
  const listed = await listNewComments(creds, floor, 3);
  const claimed = await claimedYtCommentIds(listed.map(c => c.id), channel.tenantId);
  const comments = listed.filter(c => !claimed.has(c.id));
  if (!comments.length) {
    await setCursor(channel.id, channel.tenantId, since.toISOString(), { commentsSeen: 0, repliesPosted: 0 });
    return 0;
  }
  // Loaded once per poll rather than once per comment.
  const rules = await listYtCommentRules(channel.tenantId).catch(() => undefined);

  let acted = 0;
  let lastReplyId: string | null = null;
  let lastError: string | null = null;
  let aiEnabled = aiEnabledCache.get(channel.tenantId);
  if (aiEnabled === undefined) { aiEnabled = await isAiEnabled(channel.tenantId); aiEnabledCache.set(channel.tenantId, aiEnabled); }

  // Per-tenant daily reply budget: how many more quota-consuming comment actions
  // this tenant may take today. The cap is PLAN-AWARE (getYtDailyReplyCap — higher
  // tiers raise it), shared across the tenant's channels within this run, and
  // decremented as we act. Infinity when the cap is disabled platform-wide.
  let budget = await tenantBudget(channel.tenantId, budgetCache, capCache);
  const cap = capCache.get(channel.tenantId);

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
    if (c.authorChannelId && c.authorChannelId === channel.ytChannelId) { cursorAt = later(cursorAt, c.publishedAt); continue; }

    const rule = await matchYtCommentRule(c.text, c.videoId, channel.tenantId, channel.id, rules);
    const aiWillAnswer = !rule && channel.commentAi && aiEnabled && !aiFailing.has(channel.tenantId);
    // Take no action → do NOT claim, but DO advance. Claiming here used to burn the
    // comment id permanently, so a rule created afterwards could never fire on a
    // comment the poller had already walked past with nothing to do.
    if (!rule && !aiWillAnswer) { cursorAt = later(cursorAt, c.publishedAt); continue; }

    // A quota-consuming action is due. Out of daily budget → STOP here, leaving
    // this comment and every later one for a future tick (cursor stays before it).
    if (budget <= 0) { capReached = true; break; }

    // Idempotency: claim the comment once (whether a rule fires or the AI answers).
    // Already claimed (a prior run) → nothing more to do, advance past it.
    if (!(await claimYtComment(c.id, rule?.id ?? null, channel.tenantId))) { cursorAt = later(cursorAt, c.publishedAt); continue; }
    budget -= 1;   // one comment-action spent against the tenant's daily cap

    if (rule) {
      const reply = pickPublicReply({ publicReplies: rule.publicReplies, publicReply: null });
      if (reply) {
        const r = await replyToComment(creds, c.id, reply);
        if (r.ok) { acted++; lastReplyId = r.id ?? null; answered.push(c.id); }
        else { lastError = r.error ?? "YouTube refused the reply"; console.error("[ytpoller] rule reply failed", channel.id, c.id, r.error); }
      }
      if (rule.moderate === "hold_spam") await setModeration(creds, c.id, "heldForReview");
      else if (rule.moderate === "reject_spam") await setModeration(creds, c.id, "rejected");
      await bumpYtRuleMatch(rule.id, rule.matchCount, channel.tenantId);
      cursorAt = later(cursorAt, c.publishedAt);
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
          effectiveKbScope(null, channel),
          false,
          undefined,
          "youtube",
        );
        const verdict = classifyAiReply(res, isCannedNonAnswer);
        if (verdict === "post") {
          const r = await replyToComment(creds, c.id, res.reply as string);
          if (r.ok) { acted++; lastReplyId = r.id ?? null; answered.push(c.id); }
          else { lastError = r.error ?? "YouTube refused the reply"; console.error("[ytpoller] ai reply failed", channel.id, c.id, r.error); }
        } else if (verdict === "retry") {
          // The AI is failing (provider down / quota out). Never post its
          // placeholder; give the comment back so the 24h re-read retries it,
          // and stop asking the AI for the rest of this run.
          await releaseYtComment(c.id, channel.tenantId);
          aiFailing.add(channel.tenantId);
          lastError = `The AI couldn't answer right now (${res.reason ?? "error"}) — this comment will be retried automatically. Check the AI key's quota/billing if this persists.`;
        } else if (res.escalate) {
          lastError = "The AI declined to answer this comment (not enough in the knowledge base).";
        }
      } catch (e) {
        lastError = e instanceof Error ? e.message : "AI reply failed";
        console.error("[ytpoller] ai reply", c.id, e);
      }
    }
    cursorAt = later(cursorAt, c.publishedAt);
  }

  budgetCache.set(channel.tenantId, budget < 0 ? 0 : budget);

  // Cursor: through the newest comment when we finished the batch, or only through
  // the last handled comment when the daily cap deferred the rest.
  let newestSeen = since.toISOString();
  for (const c of comments) newestSeen = later(newestSeen, c.publishedAt);
  const finalCursor = capReached ? cursorAt : newestSeen;
  if (capReached && !lastError) {
    lastError = `Daily reply cap reached (${cap}/day) — the rest will be answered automatically after midnight UTC.`;
  }

  await setCursor(channel.id, channel.tenantId, finalCursor || since.toISOString(), {
    commentsSeen: comments.length, repliesPosted: acted, lastReplyId, lastError,
  });
  return acted;
}

// Per-tenant daily reply budget, resolved once per run and shared by every
// channel and every pass (new comments and follow-ups alike).
async function tenantBudget(tenantId: string, budgetCache: Map<string, number>, capCache: Map<string, number>): Promise<number> {
  let cap = capCache.get(tenantId);
  let budget = budgetCache.get(tenantId);
  if (cap === undefined || budget === undefined) {
    cap = await getYtDailyReplyCap(tenantId);
    budget = cap > 0 ? Math.max(0, cap - (await ytActionsUsedToday(tenantId))) : Number.POSITIVE_INFINITY;
    capCache.set(tenantId, cap);
    budgetCache.set(tenantId, budget);
  }
  // White-label: a partner's workspaces share one daily cap on Talko's YouTube
  // quota, recounted at each channel's turn (replies are logged as they go).
  // Infinity for anyone not on a partner: no read at all while white-label is
  // off, one small read while it is on.
  return Math.min(budget, await partnerYtRemaining(tenantId));
}

// ── Follow-ups in threads the channel already answered ───────────────────────
// A reply never moves its thread in YouTube's listing (threads sort by the
// top-level comment's time), so the incremental poll above never sees one. The
// threads we've replied in are watched by id instead — see ytfollowups.ts for
// who gets an answer. Runs every tick for lively threads, every 15 min otherwise.
async function drainFollowUps(channel: Channel, aiEnabledCache: Map<string, boolean>, budgetCache: Map<string, number>, capCache: Map<string, number>, answered: string[], aiFailing: Set<string>): Promise<number> {
  const creds: YtCreds = { channelId: channel.ytChannelId as string, refreshToken: channel.token };
  if (!creds.channelId || !creds.refreshToken) return 0;
  const now = new Date();
  const nowIso = now.toISOString();

  let w = await getYtWatch(channel.id, channel.tenantId);
  let dirty = false;
  // Threads answered this tick join the list.
  for (const id of answered) { w.threads[id] = { seen: nowIso, active: nowIso }; dirty = true; }
  // First run: conversations already under way when this shipped.
  if (!w.seeded) {
    const since = new Date(now.getTime() - WATCH_DAYS * 86_400_000).toISOString();
    for (const t of await recentlyAnsweredThreads(channel.tenantId, since)) {
      if (!w.threads[t.threadId]) w.threads[t.threadId] = { seen: t.at, active: t.at };
    }
    w.seeded = true; dirty = true;
  }
  const before = Object.keys(w.threads).length;
  w = pruneWatch(w, now);
  if (Object.keys(w.threads).length !== before) dirty = true;

  if (!watchDue(w, now)) {
    if (dirty) await saveYtWatch(channel.id, channel.tenantId, w);
    return 0;
  }

  if (!w.handle || now.getTime() - Date.parse(w.handleAt ?? "") > 86_400_000) {
    w.handle = (await getChannelHandle(creds)) ?? w.handle ?? null;
    w.handleAt = nowIso;
  }

  const threads = await getThreads(creds, Object.keys(w.threads), t => t.totalReplies > (w.threads[t.id]?.n ?? 0));

  let aiEnabled = aiEnabledCache.get(channel.tenantId);
  if (aiEnabled === undefined) { aiEnabled = await isAiEnabled(channel.tenantId); aiEnabledCache.set(channel.tenantId, aiEnabled); }
  const answering = !!channel.commentAi && aiEnabled;
  let budget = answering ? await tenantBudget(channel.tenantId, budgetCache, capCache) : 0;

  let acted = 0;
  for (const t of threads) {
    // The token can read any public thread; only ever speak on this channel's own.
    if (t.channelId && t.channelId !== creds.channelId) { delete w.threads[t.id]; continue; }
    const st = w.threads[t.id];
    if (!st) continue;
    // While the AI is failing, hold every thread where it is — nothing is read
    // past, so whatever is waiting gets answered once the AI is back.
    let deferred = answering && aiFailing.has(channel.tenantId);
    if (answering && !deferred) {
      for (const r of pickFollowUps(t, { selfChannelId: creds.channelId, handle: w.handle, seen: st.seen, now })) {
        if (budget <= 0) { deferred = true; break; }
        if (!(await claimYtComment(r.id, null, channel.tenantId))) continue;
        budget -= 1;
        try {
          const res = await generateReply(threadHistory(t, creds.channelId, r), undefined, effectiveAgentId(null, channel),
            channel.tenantId, effectiveKbScope(null, channel), false, undefined, "youtube");
          const verdict = classifyAiReply(res, isCannedNonAnswer);
          if (verdict === "post") {
            const p = await replyToComment(creds, t.id, addressTo(r.authorName, res.reply as string));
            if (p.ok) { acted++; st.active = nowIso; }
            else console.error("[ytpoller] follow-up reply failed", channel.id, r.id, p.error);
          } else if (verdict === "retry") {
            // AI failing: release, keep the thread unread from here, stop for this run.
            await releaseYtComment(r.id, channel.tenantId);
            deferred = true;
            aiFailing.add(channel.tenantId);
            break;
          }
        } catch (e) {
          console.error("[ytpoller] follow-up", r.id, e);
        }
      }
    }
    // Read through everything in the thread — unless the daily cap deferred an
    // answer, in which case stay put so it's picked up after the reset.
    const newest = t.replies.reduce((a, r) => later(a, r.publishedAt), st.seen);
    if (!deferred) st.seen = newest;
    st.active = later(st.active, newest);
    st.n = t.totalReplies;
  }
  budgetCache.set(channel.tenantId, budget < 0 ? 0 : budget);

  w.checkedAt = nowIso;
  await saveYtWatch(channel.id, channel.tenantId, w);
  if (acted) console.log(JSON.stringify({ tag: "yt_followups", channel: channel.id, answered: acted }));
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
  // Tenants whose AI failed this run (provider down, quota out): skip further AI
  // calls for them, and read nothing past what's waiting.
  const aiFailing = new Set<string>();
  // Per-tenant remaining daily reply budget + resolved cap, shared across a
  // tenant's channels for this run so they can't each spend the full cap
  // independently (and so one plan lookup serves all the tenant's channels).
  const budgetCache = new Map<string, number>();
  const capCache = new Map<string, number>();
  let acted = 0;
  for (const ch of channels) {
    const answered: string[] = [];
    try { acted += await drainChannel(ch, aiEnabledCache, budgetCache, capCache, answered, aiFailing); }
    catch (e) { console.error("[ytpoller] channel", ch.id, e); }
    // Separate try: a failure on new comments must not stop follow-ups, or the reverse.
    try { acted += await drainFollowUps(ch, aiEnabledCache, budgetCache, capCache, answered, aiFailing); }
    catch (e) { console.error("[ytpoller] follow-ups", ch.id, e); }
  }
  return acted;
}
