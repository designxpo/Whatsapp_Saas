// Google Reviews import and reply automation. Google Business Profile has no
// new-review webhook, so the cron reads each connected location.
//
// Reading. Google lists reviews newest-changed first. Each run reads from the
// top until it reaches a review it has already processed (the "high water"
// mark), so a quiet location costs one request. A location's first run also
// leaves a bookmark, and later runs keep importing older reviews from it a few
// pages at a time until the whole history is in — a business with thousands of
// reviews never needs one giant import. A failed page throws: nothing is ever
// recorded as a successful empty sync. Locations that waited longest go first,
// and each run handles a bounded number, so one Google project's quota is
// shared fairly across every workspace.
//
// Replying. A new review from the last week gets an AI draft. It is posted only
// when lib/review-policy.ts says so (rating threshold, topics like refunds or
// safety, the AI's own confidence) AND the workspace's plan and account allow
// automation; otherwise it waits as a draft with the reasons shown. Older
// reviews are imported for the record only. A reply someone wrote directly on
// Google is imported as theirs and never overwritten automatically.
//
// Problems raise alerts (review-alerts.ts): lost access, repeated failures,
// failed posts, complaints and replies waiting for approval.

import { listChannels, isLiveChannel, type Channel } from "./channels";
import { googleReviewsConfigured, fetchReviewPage, replyToReview, locationLinks, GoogleReviewsError, type GrCreds, type GrReview } from "./googlereviews";
import {
  getReviewByExternalId, saveReview, setReviewReply, getEffectiveSettings, getChannelSync, saveChannelSync,
  claimDraft, releaseDraft, recentReplies, replyInputFor, type Review, type ReviewSettings, type GoogleSyncStatus,
} from "./reviews";
import { draftReviewReply } from "./llm";
import { decideAutoPost, type PolicyDecision } from "./review-policy";
import { raiseAlert } from "./review-alerts";
import { checkFeature } from "./entitlements";
import { accountCanSend } from "./feature-guard";
import { db } from "./supabase";
import { tdb } from "./tenantdb";

const RETRY_FOR_MS = 24 * 3_600_000;
const MAX_RETRIES_PER_RUN = 5;
// A review older than this when first seen is imported for the record only:
// connecting a profile, or "Sync from Google", must not have the AI post public
// replies to years-old reviews. A person can still draft one with a click.
const AUTO_REPLY_MAX_AGE_MS = 7 * 86_400_000;
// Posted replies younger than this aren't treated as removed on Google when
// Google's list doesn't show them yet.
const REMOVAL_GRACE_MS = 10 * 60_000;
const LINKS_EVERY_MS = 7 * 86_400_000;
const FAILING_AFTER = 3;
const MAX_CHANNELS_PER_RUN = 60;

const isRecent = (iso: string | null | undefined, now: number) => !!iso && now - Date.parse(iso) <= AUTO_REPLY_MAX_AGE_MS;
const day = (now: number) => new Date(now).toISOString().slice(0, 10);

export interface SyncCounts { imported: number; updated: number }

interface Ctx {
  channel: Channel;
  creds: GrCreds;
  settings: ReviewSettings;
  /** Plan and account allow drafting and posting without a person. */
  canAutomate: boolean;
  now: number;
  retries: number;
  counts: SyncCounts;
}

const credsOf = (ch: Channel): GrCreds => ({ channelId: ch.id, refreshToken: ch.token, accountId: ch.googleAccountId, locationId: ch.googleLocationId });

function rulesOnly(r: Pick<GrReview, "rating" | "text">, settings: ReviewSettings): PolicyDecision {
  return decideAutoPost({ rating: r.rating, text: r.text, autoMinStars: settings.autoMinStars, holdFor: settings.holdFor, ai: null });
}

function draftErrorText(msg: string): string {
  if (/AI_BUSY|quota|429/i.test(msg)) return "The AI was busy or out of quota. Talko tries again shortly.";
  if (/api key|AiKeyMissing|not configured/i.test(msg)) return "AI isn't set up for this workspace (add an AI key in AI Hub).";
  if (/safety filter/i.test(msg)) return "The AI's draft was blocked by the content safety filter. Write this reply yourself.";
  return "The AI couldn't draft a reply. Talko tries again shortly.";
}

// Draft (and maybe post) a reply. Claimed first, so two overlapping runs never
// draft or post the same review. Returns what happened.
async function draftAndDecide(ctx: Ctx, reviewId: string, r: GrReview): Promise<"posted" | "held" | "failed" | "skipped"> {
  const { channel, settings } = ctx;
  const tenantId = channel.tenantId;
  if (!(await claimDraft(reviewId, tenantId, ctx.now))) return "skipped";
  try {
    let draft;
    try {
      draft = await draftReviewReply(
        replyInputFor(r, settings, { businessName: channel.name, recentReplies: await recentReplies(tenantId, channel.id) }),
        tenantId,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[reviewpoller] ai draft", channel.id, r.externalId, msg);
      const d = rulesOnly(r, settings);
      await setReviewReply(reviewId, tenantId, "", "none", false, { topics: d.topics, isComplaint: d.complaint, approvalReasons: d.reasons, draftError: draftErrorText(msg) });
      return "failed";
    }
    const d = decideAutoPost({ rating: r.rating, text: r.text, autoMinStars: settings.autoMinStars, holdFor: settings.holdFor, ai: draft.ai });
    if (d.autoPost && ctx.canAutomate) {
      const posted = await replyToReview(ctx.creds, r.externalId, draft.reply, tenantId);
      if (posted.ok) {
        await setReviewReply(reviewId, tenantId, draft.reply, "posted", true, { replySource: "talko", topics: d.topics, isComplaint: d.complaint, draftError: null });
        return "posted";
      }
      console.error("[reviewpoller] live reply failed", channel.id, r.externalId, posted.error);
      await setReviewReply(reviewId, tenantId, draft.reply, "draft", true, {
        topics: d.topics, isComplaint: d.complaint, draftError: null, postError: posted.error ?? "Google refused the reply",
        approvalReasons: ["Talko tried to post this automatically, but Google refused it. Check it and post again."],
      });
      await raiseAlert(tenantId, {
        kind: "post_failed", dedupeKey: `review:${reviewId}:post_failed:${day(ctx.now)}`, reviewId, channelId: channel.id,
        title: `A reply to ${r.author || "a customer"} couldn't be posted to Google`, body: posted.error ?? "",
      });
      return "held";
    }
    const reasons = d.autoPost ? ["Automatic posting is paused: your plan or account doesn't allow it right now."] : d.reasons;
    await setReviewReply(reviewId, tenantId, draft.reply, "draft", false, { approvalReasons: reasons, topics: d.topics, isComplaint: d.complaint, draftError: null });
    return "held";
  } finally {
    await releaseDraft(reviewId, tenantId);
  }
}

// One alert per newly arrived review: the most important thing about it.
async function alertArrival(ctx: Ctx, review: Review, outcome: "posted" | "held" | "failed" | "skipped" | "old") {
  if (outcome === "old" || outcome === "skipped") return;
  const tenantId = ctx.channel.tenantId;
  const fresh = (await getReviewByExternalId(tenantId, "google", review.externalId ?? "")) ?? review;
  const who = review.author || "A customer";
  const stars = review.rating ? `${review.rating}★ ` : "";
  const where = ctx.channel.name;
  const base = { dedupeKey: `review:${review.id}:arrived`, reviewId: review.id, channelId: ctx.channel.id };
  const reasons = fresh.approvalReasons.slice(0, 2).join(" ");
  const tries: { kind: "complaint" | "needs_approval" | "new_review"; title: string; body: string }[] = [];
  if (fresh.isComplaint) tries.push({ kind: "complaint", title: `Complaint: ${who} left a ${stars}review for ${where}`, body: review.text.slice(0, 200) });
  if (outcome === "held") tries.push({ kind: "needs_approval", title: `${who}'s ${stars}review for ${where} has a reply waiting for approval`, body: reasons });
  tries.push({
    kind: "new_review",
    title: `New ${stars}review from ${who} for ${where}`,
    body: outcome === "posted" ? "Replied automatically." : outcome === "failed" ? "The AI couldn't draft a reply yet." : review.text.slice(0, 200),
  });
  for (const t of tries) if (await raiseAlert(tenantId, { ...base, ...t })) return;
}

async function processReview(ctx: Ctx, r: GrReview): Promise<void> {
  const { channel, settings, now } = ctx;
  const tenantId = channel.tenantId;
  const known = await getReviewByExternalId(tenantId, "google", r.externalId);

  if (!known) {
    let saved: Review;
    try {
      saved = await saveReview({
        source: "google", externalId: r.externalId, channelId: channel.id, locationName: channel.name,
        author: r.author, rating: r.rating, text: r.text, reviewCreatedAt: r.createTime, reviewUpdatedAt: r.updateTime,
      }, tenantId);
    } catch (e) {
      // Another run imported it a moment ago (unique index): that run owns it.
      if ((e as { code?: string }).code === "23505") return;
      throw e;
    }
    ctx.counts.imported++;
    if (r.existingReply) {
      // Already answered on Google directly — keep their reply, never draft over it.
      const d = rulesOnly(r, settings);
      await setReviewReply(saved.id, tenantId, r.existingReply, "posted", false, { replySource: "google", topics: d.topics, isComplaint: d.complaint, postedAt: r.existingReplyTime });
      return;
    }
    if (!isRecent(r.createTime ?? new Date(now).toISOString(), now)) {
      const d = rulesOnly(r, settings);
      if (d.complaint || d.topics.length) await setReviewReply(saved.id, tenantId, "", "none", false, { topics: d.topics, isComplaint: d.complaint });
      return alertArrival(ctx, saved, "old");
    }
    if (!ctx.canAutomate) {
      const d = rulesOnly(r, settings);
      await setReviewReply(saved.id, tenantId, "", "none", false, { topics: d.topics, isComplaint: d.complaint, approvalReasons: ["AI replies are paused: your plan or account doesn't allow them right now."] });
      return alertArrival(ctx, saved, "failed");
    }
    return alertArrival(ctx, saved, await draftAndDecide(ctx, saved.id, r));
  }

  // Google is the record of what is public: a customer can edit their review,
  // and a reply can be written, edited or removed on Google directly.
  const textChanged = known.rating !== r.rating || known.text.trim() !== r.text.trim();
  if (textChanged || known.author !== r.author || !known.channelId) {
    await saveReview({
      id: known.id, source: "google", externalId: r.externalId, channelId: channel.id, locationName: known.locationName ?? channel.name,
      author: r.author, rating: r.rating, text: r.text, reviewCreatedAt: r.createTime ?? known.reviewCreatedAt, reviewUpdatedAt: r.updateTime,
    }, tenantId);
    if (textChanged) {
      ctx.counts.updated++;
      const d = rulesOnly(r, settings);
      if (known.replyStatus === "draft" && !r.existingReply) {
        await setReviewReply(known.id, tenantId, known.replyText ?? "", "draft", known.auto, {
          topics: d.topics, isComplaint: d.complaint,
          approvalReasons: ["The customer changed their review after this draft was written. Check the reply still fits.", ...d.reasons.filter(x => !/automatically/.test(x))],
        });
      } else if (d.complaint !== known.isComplaint) {
        await setReviewReply(known.id, tenantId, known.replyText ?? "", known.replyStatus, known.auto, { topics: d.topics, isComplaint: d.complaint, replySource: known.replySource });
      }
    }
  }
  if (r.existingReply) {
    if (known.replyStatus !== "posted" || (known.replyText ?? "").trim() !== r.existingReply.trim()) {
      await setReviewReply(known.id, tenantId, r.existingReply, "posted", known.auto, { replySource: "google", postedAt: r.existingReplyTime });
      ctx.counts.updated++;
    }
    return;
  }
  if (known.replyStatus === "posted") {
    // Removed on Google: keep the text as a draft so it can be posted again.
    if (known.postedAt && now - Date.parse(known.postedAt) > REMOVAL_GRACE_MS) {
      await setReviewReply(known.id, tenantId, known.replyText ?? "", "draft", known.auto, { approvalReasons: ["This reply was removed from Google. Post it again, or edit it first."] });
      ctx.counts.updated++;
    }
    return;
  }
  // Imported before but still without a reply — the AI was busy, or the
  // workspace's plan didn't allow automation then. Try again for a day, a few
  // per run, only for recent reviews.
  if (known.replyStatus !== "none" || !ctx.canAutomate) return;
  if (!isRecent(r.createTime ?? known.createdAt, now)) return;
  if (now - Date.parse(known.createdAt) > RETRY_FOR_MS || ctx.retries >= MAX_RETRIES_PER_RUN) return;
  ctx.retries++;
  await draftAndDecide(ctx, known.id, r);
}

async function failRun(channel: Channel, e: unknown, now: number): Promise<void> {
  const kind = e instanceof GoogleReviewsError ? e.kind : "other";
  const message = e instanceof Error ? e.message : "Google Reviews couldn't be read.";
  const cur = await getChannelSync(channel.tenantId, channel.id);
  const next: GoogleSyncStatus = { ...cur, ok: false, error: message, kind, at: new Date(now).toISOString(), failures: cur.failures + 1 };
  await saveChannelSync(channel.tenantId, channel.id, next);
  if (kind === "reauth" || kind === "permission") {
    await raiseAlert(channel.tenantId, {
      kind: "reauth", dedupeKey: `channel:${channel.id}:reauth:${day(now)}`, channelId: channel.id,
      title: `Reconnect Google for ${channel.name}`, body: `${message} New reviews won't arrive until you reconnect.`,
    });
  } else if (next.failures >= FAILING_AFTER) {
    await raiseAlert(channel.tenantId, {
      kind: "sync_failing", dedupeKey: `channel:${channel.id}:failing:${day(now)}`, channelId: channel.id,
      title: `Reviews for ${channel.name} haven't synced for a while`, body: message,
    });
  }
}

/**
 * One location: new and changed reviews from the top, then (until done) a few
 * more pages of history from the bookmark. Records the outcome; rethrows a
 * failure after recording it.
 */
async function syncChannel(channel: Channel, opts: { topPages: number; historyPages: number; now: number; deadlineAt: number }): Promise<SyncCounts> {
  const counts: SyncCounts = { imported: 0, updated: 0 };
  const { now } = opts;
  if (!channel.googleAccountId || !channel.googleLocationId || !channel.token) return counts;
  const tenantId = channel.tenantId;
  const state = await getChannelSync(tenantId, channel.id);
  const at = new Date(now).toISOString();

  // A workspace whose plan no longer includes Google Reviews stops here:
  // nothing imported, nothing drafted, nothing posted.
  const gate = await checkFeature(tenantId, "reviews").catch(() => ({ ok: true }));
  if (!gate.ok) {
    await saveChannelSync(tenantId, channel.id, { ...state, ok: false, kind: "plan", error: "Google Reviews isn't included in your current plan, so new reviews aren't being imported.", at });
    return counts;
  }

  const ctx: Ctx = {
    channel, creds: credsOf(channel), settings: await getEffectiveSettings(tenantId, channel.id),
    canAutomate: await accountCanSend(tenantId).catch(() => false), now, retries: 0, counts,
  };
  const next: GoogleSyncStatus = { ...state };
  try {
    // 1. From the top until we reach what we already have.
    let token: string | null = null;
    let newest: string | null = null;
    let reachedKnown = false;
    for (let page = 0; page < opts.topPages; page++) {
      const p = await fetchReviewPage(ctx.creds, token);
      if (page === 0) { next.averageRating = p.averageRating; next.totalReviewCount = p.totalReviewCount; next.ratingAt = at; }
      for (const r of p.reviews) {
        if (r.updateTime && (!newest || r.updateTime > newest)) newest = r.updateTime;
        await processReview(ctx, r);
      }
      token = p.nextPageToken;
      if (state.highWater && p.reviews.some(r => r.updateTime && r.updateTime <= state.highWater!)) { reachedKnown = true; break; }
      if (!token) { reachedKnown = true; break; }
      if (Date.now() > opts.deadlineAt) break;
    }
    if (!state.highWater) {
      // First run: the rest of the history continues from here on later runs.
      next.backfillDone = reachedKnown;
      next.backfillToken = reachedKnown ? null : token;
      if (newest) next.highWater = newest;
    } else if (reachedKnown && newest && newest > state.highWater) {
      // Only move the mark when everything newer than it was read; otherwise a
      // burst of changes bigger than one run would leave a gap.
      next.highWater = newest;
    }

    // 2. Older history, a few pages per run, from the bookmark.
    if (state.highWater && !next.backfillDone) {
      for (let page = 0; page < opts.historyPages && Date.now() < opts.deadlineAt; page++) {
        let p;
        try { p = await fetchReviewPage(ctx.creds, next.backfillToken); }
        catch (e) {
          // A bookmark Google no longer accepts: walk the history again from
          // the top next time (imports are idempotent).
          if (e instanceof GoogleReviewsError && e.kind === "other") { next.backfillToken = null; break; }
          throw e;
        }
        for (const r of p.reviews) await processReview(ctx, r);
        next.backfillToken = p.nextPageToken;
        if (!p.nextPageToken) { next.backfillDone = true; break; }
      }
    }

    // 3. The location's public links, about once a week.
    if (!state.linksAt || now - Date.parse(state.linksAt) > LINKS_EVERY_MS) {
      const links = await locationLinks(ctx.creds).catch(() => ({ error: "unavailable" } as { reviewUri?: string; mapsUri?: string; error?: string }));
      if (!links.error) { next.mapsUri = links.mapsUri ?? null; next.reviewUri = links.reviewUri ?? null; next.linksAt = at; }
    }

    await saveChannelSync(tenantId, channel.id, { ...next, ok: true, error: null, kind: null, at, lastSuccessAt: at, failures: 0 });

    // 4. Today's rating snapshot (Google's own figures), so trends are drawn
    // only from days that were actually recorded. One row per day; later runs
    // the same day just refresh it.
    if (next.totalReviewCount != null || next.averageRating != null) {
      const { error } = await tdb(tenantId).from("wa_review_rating_snapshots").upsert(
        { channel_id: channel.id, day: day(now), average_rating: next.averageRating, total_review_count: next.totalReviewCount },
        { onConflict: "tenant_id,channel_id,day" },
      );
      if (error && !/wa_review_rating_snapshots|PGRST205|42P01/.test(`${error.code} ${error.message}`)) console.error("[reviewpoller] snapshot", channel.id, error.message);
    }
  } catch (e) {
    console.error("[reviewpoller] channel", channel.id, e instanceof Error ? e.message : e);
    await failRun(channel, e, now);
    throw e;
  }
  return counts;
}

const googleChannels = async (tenantId?: string) =>
  (await listChannels(tenantId)).filter(c => c.kind === "google_reviews" && isLiveChannel(c) && c.googleAccountId && c.googleLocationId);

// When each location last ran, from one query, so the longest-waiting go first.
async function lastRunAt(): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const { data } = await db().from("wa_settings").select("key,value").like("key", "google_reviews_sync:%");
  for (const row of (data ?? []) as { key: string; value: { at?: string } | null }[]) {
    out.set(row.key.slice("google_reviews_sync:".length), Date.parse(row.value?.at ?? "") || 0);
  }
  return out;
}

// Cron entrypoint — returns the number of reviews imported this run.
export async function drainGoogleReviews(deadlineAt = Date.now() + 100_000, now = Date.now()): Promise<number> {
  if (!googleReviewsConfigured()) return 0;
  let channels: Channel[];
  try { channels = await googleChannels(); } catch { return 0; }
  if (!channels.length) return 0;
  const last = await lastRunAt().catch(() => new Map<string, number>());
  channels.sort((a, b) => (last.get(a.id) ?? 0) - (last.get(b.id) ?? 0));
  let imported = 0;
  for (const ch of channels.slice(0, MAX_CHANNELS_PER_RUN)) {
    if (Date.now() > deadlineAt) break;
    try { imported += (await syncChannel(ch, { topPages: 4, historyPages: 2, now, deadlineAt })).imported; }
    catch { /* recorded on the location by syncChannel */ }
  }
  return imported;
}

// "Sync from Google now" — one workspace, deeper than the cron, returning what
// changed and any location Google refused.
export async function syncTenantGoogleReviews(tenantId: string, now = Date.now()): Promise<SyncCounts & { profiles: number; errors: { profile: string; error: string }[] }> {
  const out = { imported: 0, updated: 0, profiles: 0, errors: [] as { profile: string; error: string }[] };
  if (!googleReviewsConfigured()) return { ...out, errors: [{ profile: "Google", error: "Google Reviews isn't available right now." }] };
  const deadlineAt = Date.now() + 90_000;
  for (const ch of await googleChannels(tenantId)) {
    out.profiles++;
    try {
      const r = await syncChannel(ch, { topPages: 4, historyPages: 16, now, deadlineAt });
      out.imported += r.imported; out.updated += r.updated;
      const s = await getChannelSync(tenantId, ch.id);
      if (s.kind === "plan" && s.error) out.errors.push({ profile: ch.name, error: s.error });
    } catch (e) {
      out.errors.push({ profile: ch.name, error: e instanceof Error ? e.message : "Couldn't read Google." });
    }
  }
  return out;
}
