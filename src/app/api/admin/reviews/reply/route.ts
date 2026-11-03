import { NextResponse } from "next/server";
import { getReview, setReviewReply, getReviewSettings, autoPosts, markPostFailed } from "@/lib/reviews";
import { draftReviewReply } from "@/lib/llm";
import { decideAutoPost } from "@/lib/review-policy";
import { guardFeature } from "@/lib/feature-guard";
import { listChannels } from "@/lib/channels";
import { replyToReview, deleteReviewReply, type GrCreds } from "@/lib/googlereviews";
import { currentTenantId, requireRoleAdmin, DEFAULT_TENANT_ID } from "@/lib/auth";
import { AiKeyMissingError } from "@/lib/ai/keys";
import { errorMessage } from "@/lib/errors";

// The connection that owns this review. A Google review's resource name is
// "accounts/{a}/locations/{l}/reviews/{r}", so it names its own profile. A
// tenant can connect several profiles; replying with the first one's
// credentials sends the PUT under a login that may not manage this location.
// No guessing: if the owning profile isn't connected, the reply is refused.
async function googleCredsFor(tenantId: string, externalId: string): Promise<GrCreds | null> {
  const connected = (await listChannels(tenantId)).filter(c => c.kind === "google_reviews" && c.active && c.googleAccountId && c.googleLocationId && c.token);
  const owner =
    connected.find(c => externalId.startsWith(`${c.googleAccountId}/${c.googleLocationId}/`)) ??
    // Same location reached through a different account (e.g. a location group).
    connected.find(c => externalId.includes(`/${c.googleLocationId}/reviews/`));
  return owner ? { channelId: owner.id, refreshToken: owner.token, accountId: owner.googleAccountId, locationId: owner.googleLocationId } : null;
}

export const dynamic = "force-dynamic";
export const maxDuration = 60; // LLM call — must outlast Vercel's ~10s default

// POST { id, action } — AI-draft / save / post a review reply.
//   action "generate" → AI drafts a reply, saved as a draft, returned
//   action "save"     → persist an edited draft (body.text)
//   action "post"     → mark posted (body.text optional to save edits first)
//   action "unpost"   → revert a posted reply back to draft
export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  const gate = await guardFeature(tid, "reviews");
  if (gate) return gate;
  let body: { id?: string; action?: string; text?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const review = await getReview(body.id, tid);
  if (!review) return NextResponse.json({ error: "Review not found" }, { status: 404 });
  const settings = await getReviewSettings(tid);
  const auto = autoPosts(review.rating, settings);

  try {
    if (body.action === "generate") {
      const draft = await draftReviewReply(
        { author: review.author, rating: review.rating, text: review.text, businessName: review.locationName ?? undefined, tone: settings.tone, signature: settings.signature },
        tid,
      );
      // The same reading the automation uses, so a person sees why this one
      // would (or wouldn't) have posted on its own.
      const d = decideAutoPost({ rating: review.rating, text: review.text, autoMinStars: settings.autoMinStars, holdFor: settings.holdFor, ai: draft.ai });
      const saved = await setReviewReply(review.id, tid, draft.reply, "draft", auto, { approvalReasons: d.reasons, topics: d.topics, isComplaint: d.complaint || review.isComplaint, draftError: null });
      return NextResponse.json({ review: saved });
    }
    if (body.action === "save") {
      const saved = await setReviewReply(review.id, tid, String(body.text ?? ""), "draft", auto);
      return NextResponse.json({ review: saved });
    }
    if (body.action === "post") {
      const text = body.text !== undefined ? String(body.text) : (review.replyText ?? "");
      if (!text.trim()) return NextResponse.json({ error: "Nothing to post — draft a reply first" }, { status: 400 });
      // A Google-sourced review posts live via the Business Profile API; a
      // manually-added one just records the reply (there's nowhere to post it).
      if (review.source === "google" && review.externalId) {
        const creds = await googleCredsFor(tid, review.externalId);
        if (!creds) return NextResponse.json({ error: "The Google Business Profile this review belongs to isn't connected. Reconnect it in the Reviews tab, then post again." }, { status: 400 });
        const posted = await replyToReview(creds, review.externalId, text, tid);
        if (!posted.ok) {
          // Kept on the review (the "Failed" view), so it stays actionable.
          await markPostFailed(review.id, tid, posted.error || "Google refused the reply");
          // A draft keeps its edited text. A reply already on Google keeps the
          // text Google actually shows — the failed edit didn't change it.
          if (body.text !== undefined && review.replyStatus !== "posted") await setReviewReply(review.id, tid, text, "draft", auto, { postError: posted.error || "Google refused the reply" });
          return NextResponse.json({ error: posted.error || "Google refused the reply" }, { status: 502 });
        }
      }
      const saved = await setReviewReply(review.id, tid, text, "posted", auto, { replySource: review.source === "google" ? "talko" : "manual" });
      return NextResponse.json({ review: saved });
    }
    if (body.action === "unpost") {
      if (review.source === "google" && review.externalId) {
        const creds = await googleCredsFor(tid, review.externalId);
        if (creds) {
          const removed = await deleteReviewReply(creds, review.externalId);
          if (!removed.ok) return NextResponse.json({ error: removed.error || "Google refused to remove the reply" }, { status: 502 });
        }
      }
      const saved = await setReviewReply(review.id, tid, review.replyText ?? "", "draft", auto);
      return NextResponse.json({ review: saved });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    const busy = err instanceof Error && /AI_BUSY/.test(err.message);
    const msg = err instanceof AiKeyMissingError
      ? "AI isn't configured for this workspace yet (add an API key in Settings)."
      : busy ? "AI is busy right now (model overloaded) — try again."
      : errorMessage(err);
    return NextResponse.json({ error: msg }, { status: busy ? 503 : 500 });
  }
}
