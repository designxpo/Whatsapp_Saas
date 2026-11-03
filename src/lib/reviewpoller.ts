// Google Reviews poller (Phase 2). Google Business Profile has no new-review
// webhook, so the cron pulls each connected location's reviews, imports any not
// already seen, and applies the tenant's reply policy: ratings at/above the
// auto-post threshold get an AI-drafted reply posted immediately; everything
// else is saved as a draft for a human to approve. Reviews the owner already
// replied to via Google directly are imported as already-posted (no AI call).
//
// listReviews() throws when Google can't be read (revoked access, a login
// that no longer manages the profile, API errors). That is recorded per
// connection (recordGoogleSync) and shown in the Reviews tab, rather than
// passing silently as "no new reviews".

import { listChannels, isLiveChannel, type Channel } from "./channels";
import { googleReviewsConfigured, listReviews, replyToReview, type GrCreds, type GrReview } from "./googlereviews";
import { getReviewByExternalId, saveReview, setReviewReply, getReviewSettings, autoPosts, recordGoogleSync, type ReviewSettings } from "./reviews";
import { generateReviewReply } from "./llm";

const RETRY_FOR_MS = 24 * 3_600_000;
const MAX_RETRIES_PER_TICK = 5;

// AI-draft a reply and, when the rating meets the tenant's auto-post threshold,
// post it. A failure leaves the review at replyStatus "none": the next tick
// retries it (see drainChannel), and a person can always draft one by hand.
async function draftReply(channel: Channel, creds: GrCreds, reviewId: string, r: GrReview, settings: ReviewSettings): Promise<void> {
  const auto = autoPosts(r.rating, settings);
  try {
    const reply = await generateReviewReply(
      { author: r.author, rating: r.rating, text: r.text, businessName: channel.name, tone: settings.tone, signature: settings.signature },
      channel.tenantId,
    );
    if (auto) {
      const posted = await replyToReview(creds, r.externalId, reply, channel.tenantId);
      await setReviewReply(reviewId, channel.tenantId, reply, posted.ok ? "posted" : "draft", true);
      if (!posted.ok) console.error("[reviewpoller] live reply failed", channel.id, r.externalId, posted.error);
    } else {
      await setReviewReply(reviewId, channel.tenantId, reply, "draft", false);
    }
  } catch (e) {
    console.error("[reviewpoller] ai draft", channel.id, r.externalId, e);
  }
}

export interface SyncCounts { imported: number; updated: number }

// A review older than this when first seen is imported for the record only:
// connecting a profile, or "Sync from Google", must not have the AI post public
// replies to years-old reviews. A person can still draft one with a click.
const AUTO_REPLY_MAX_AGE_MS = 7 * 86_400_000;
const isRecent = (iso: string | null | undefined, now: number) => !!iso && now - Date.parse(iso) <= AUTO_REPLY_MAX_AGE_MS;

// Posted replies younger than this aren't treated as removed on Google when
// Google's list doesn't show them yet.
const REMOVAL_GRACE_MS = 10 * 60_000;

async function drainChannel(channel: Channel, maxPages = 4, now = Date.now()): Promise<SyncCounts> {
  if (!channel.googleAccountId || !channel.googleLocationId || !channel.token) return { imported: 0, updated: 0 };
  const creds: GrCreds = {
    channelId: channel.id, refreshToken: channel.token,
    accountId: channel.googleAccountId, locationId: channel.googleLocationId,
  };
  let reviews;
  try {
    reviews = await listReviews(creds, maxPages);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Google Reviews couldn't be read.";
    await recordGoogleSync(channel.tenantId, channel.id, message);
    throw e;
  }
  await recordGoogleSync(channel.tenantId, channel.id, null);
  if (!reviews.length) return { imported: 0, updated: 0 };

  const settings = await getReviewSettings(channel.tenantId);
  let imported = 0, updated = 0, retries = 0;
  for (const r of reviews) {
    const known = await getReviewByExternalId(channel.tenantId, "google", r.externalId);
    if (known) {
      // Google is the record of what is public: a customer can edit their
      // review, and a reply can be edited or removed on Google directly.
      if (known.rating !== r.rating || known.text.trim() !== r.text.trim() || known.author !== r.author) {
        await saveReview({
          id: known.id, source: "google", externalId: r.externalId, locationName: known.locationName,
          author: r.author, rating: r.rating, text: r.text, reviewCreatedAt: r.createTime ?? known.reviewCreatedAt,
        }, channel.tenantId);
        updated++;
      }
      if (r.existingReply) {
        if (known.replyStatus !== "posted" || (known.replyText ?? "").trim() !== r.existingReply.trim()) {
          await setReviewReply(known.id, channel.tenantId, r.existingReply, "posted", known.auto);
          updated++;
        }
        continue;
      }
      if (known.replyStatus === "posted") {
        // Removed on Google: keep the text as a draft so it can be posted again.
        if (known.postedAt && now - Date.parse(known.postedAt) > REMOVAL_GRACE_MS) {
          await setReviewReply(known.id, channel.tenantId, known.replyText ?? "", "draft", known.auto);
          updated++;
        }
        continue;
      }
      // Imported before but still without a reply. That happens when the AI was
      // busy on the tick that imported it: the review was saved, the draft
      // failed, and every later tick skipped it as "already imported", so it
      // never got a reply. Try again on later ticks, for a day, a few per tick.
      if (known.replyStatus !== "none") continue;
      if (!isRecent(r.createTime ?? known.createdAt, now)) continue;
      if (now - Date.parse(known.createdAt) > RETRY_FOR_MS || retries >= MAX_RETRIES_PER_TICK) continue;
      retries++;
      await draftReply(channel, creds, known.id, r, settings);
      continue;
    }

    const saved = await saveReview({
      source: "google", externalId: r.externalId, locationName: channel.name,
      author: r.author, rating: r.rating, text: r.text, reviewCreatedAt: r.createTime,
    }, channel.tenantId);
    imported++;

    if (r.existingReply) {
      // The owner (or someone) already replied on Google directly — reflect
      // that instead of drafting/posting a second reply on top of it.
      await setReviewReply(saved.id, channel.tenantId, r.existingReply, "posted", false);
      continue;
    }
    if (!isRecent(r.createTime ?? new Date(now).toISOString(), now)) continue;   // old review: imported, left for a person
    await draftReply(channel, creds, saved.id, r, settings);
  }
  return { imported, updated };
}

const googleChannels = async (tenantId?: string) =>
  (await listChannels(tenantId)).filter(c => c.kind === "google_reviews" && isLiveChannel(c) && c.googleAccountId && c.googleLocationId);

// Cron entrypoint — poll every connected, fully-configured Google Reviews
// channel. Returns the number of reviews imported this tick.
export async function drainGoogleReviews(): Promise<number> {
  if (!googleReviewsConfigured()) return 0;
  let channels: Channel[];
  try { channels = await googleChannels(); } catch { return 0; }
  if (!channels.length) return 0;
  let imported = 0;
  for (const ch of channels) {
    try { imported += (await drainChannel(ch)).imported; }
    catch (e) { console.error("[reviewpoller] channel", ch.id, e); }
  }
  return imported;
}

// "Sync from Google now" — one workspace, deeper than the cron (up to 1,000
// reviews per profile), returning what changed and any profile Google refused.
export async function syncTenantGoogleReviews(tenantId: string): Promise<SyncCounts & { profiles: number; errors: { profile: string; error: string }[] }> {
  const out = { imported: 0, updated: 0, profiles: 0, errors: [] as { profile: string; error: string }[] };
  if (!googleReviewsConfigured()) return { ...out, errors: [{ profile: "Google", error: "Google Reviews isn't configured on this deployment." }] };
  for (const ch of await googleChannels(tenantId)) {
    out.profiles++;
    try {
      const r = await drainChannel(ch, 20);
      out.imported += r.imported; out.updated += r.updated;
    } catch (e) {
      out.errors.push({ profile: ch.name, error: e instanceof Error ? e.message : "Couldn't read Google." });
    }
  }
  return out;
}
