// Google Reviews poller (Phase 2). Google Business Profile has no new-review
// webhook, so the cron pulls each connected location's reviews, imports any not
// already seen, and applies the tenant's reply policy: ratings at/above the
// auto-post threshold get an AI-drafted reply posted immediately; everything
// else is saved as a draft for a human to approve. Reviews the owner already
// replied to via Google directly are imported as already-posted (no AI call).
//
// Best-effort throughout: a pending Business Profile API access request (see
// googlereviews.ts) makes listReviews()/replyToReview() return empty/failed
// rather than throw, so this simply imports nothing until access is granted.

import { listChannels, type Channel } from "./channels";
import { googleReviewsConfigured, listReviews, replyToReview, type GrCreds } from "./googlereviews";
import { getReviewByExternalId, saveReview, setReviewReply, getReviewSettings } from "./reviews";
import { generateReviewReply } from "./llm";

async function drainChannel(channel: Channel): Promise<number> {
  if (!channel.googleAccountId || !channel.googleLocationId || !channel.token) return 0;
  const creds: GrCreds = {
    channelId: channel.id, refreshToken: channel.token,
    accountId: channel.googleAccountId, locationId: channel.googleLocationId,
  };
  const reviews = await listReviews(creds);
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

    const auto = r.rating >= settings.autoMinStars;
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
    channels = (await listChannels()).filter(c => c.kind === "google_reviews" && c.active && c.googleAccountId && c.googleLocationId && c.token);
  } catch { return 0; }
  if (!channels.length) return 0;
  let imported = 0;
  for (const ch of channels) {
    try { imported += await drainChannel(ch); }
    catch (e) { console.error("[reviewpoller] channel", ch.id, e); }
  }
  return imported;
}
