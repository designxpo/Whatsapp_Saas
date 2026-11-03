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
import { googleReviewsConfigured, listReviews, replyToReview, type GrCreds } from "./googlereviews";
import { getReviewByExternalId, saveReview, setReviewReply, getReviewSettings, autoPosts, recordGoogleSync } from "./reviews";
import { generateReviewReply } from "./llm";

async function drainChannel(channel: Channel): Promise<number> {
  if (!channel.googleAccountId || !channel.googleLocationId || !channel.token) return 0;
  const creds: GrCreds = {
    channelId: channel.id, refreshToken: channel.token,
    accountId: channel.googleAccountId, locationId: channel.googleLocationId,
  };
  let reviews;
  try {
    reviews = await listReviews(creds);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Google Reviews couldn't be read.";
    await recordGoogleSync(channel.tenantId, channel.id, message);
    throw e;
  }
  await recordGoogleSync(channel.tenantId, channel.id, null);
  if (!reviews.length) return 0;

  const settings = await getReviewSettings(channel.tenantId);
  let imported = 0;
  for (const r of reviews) {
    if (await getReviewByExternalId(channel.tenantId, "google", r.externalId)) continue;   // already imported

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

    const auto = autoPosts(r.rating, settings);
    try {
      const reply = await generateReviewReply(
        { author: r.author, rating: r.rating, text: r.text, businessName: channel.name, tone: settings.tone, signature: settings.signature },
        channel.tenantId,
      );
      if (auto) {
        const posted = await replyToReview(creds, r.externalId, reply);
        await setReviewReply(saved.id, channel.tenantId, reply, posted.ok ? "posted" : "draft", true);
        if (!posted.ok) console.error("[reviewpoller] live reply failed", channel.id, r.externalId, posted.error);
      } else {
        await setReviewReply(saved.id, channel.tenantId, reply, "draft", false);
      }
    } catch (e) {
      console.error("[reviewpoller] ai draft", channel.id, r.externalId, e);   // leave as replyStatus "none" — a human can generate one manually
    }
  }
  return imported;
}

// Cron entrypoint — poll every connected, fully-configured Google Reviews
// channel. Returns the number of reviews imported this tick.
export async function drainGoogleReviews(): Promise<number> {
  if (!googleReviewsConfigured()) return 0;
  let channels: Channel[];
  try {
    channels = (await listChannels()).filter(c => c.kind === "google_reviews" && isLiveChannel(c) && c.googleAccountId && c.googleLocationId);
  } catch { return 0; }
  if (!channels.length) return 0;
  let imported = 0;
  for (const ch of channels) {
    try { imported += await drainChannel(ch); }
    catch (e) { console.error("[reviewpoller] channel", ch.id, e); }
  }
  return imported;
}
