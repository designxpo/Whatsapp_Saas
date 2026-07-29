import { NextResponse } from "next/server";
import { getReview, setReviewReply, getReviewSettings } from "@/lib/reviews";
import { generateReviewReply } from "@/lib/llm";
import { currentTenantId, requireRoleAdmin, DEFAULT_TENANT_ID } from "@/lib/auth";
import { AiKeyMissingError } from "@/lib/ai/keys";
import { errorMessage } from "@/lib/errors";

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
  let body: { id?: string; action?: string; text?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const review = await getReview(body.id, tid);
  if (!review) return NextResponse.json({ error: "Review not found" }, { status: 404 });
  const settings = await getReviewSettings(tid);
  const auto = review.rating >= settings.autoMinStars;   // rating meets the auto-post threshold

  try {
    if (body.action === "generate") {
      const reply = await generateReviewReply(
        { author: review.author, rating: review.rating, text: review.text, businessName: review.locationName ?? undefined, tone: settings.tone, signature: settings.signature },
        tid,
      );
      const saved = await setReviewReply(review.id, tid, reply, "draft", auto);
      return NextResponse.json({ review: saved });
    }
    if (body.action === "save") {
      const saved = await setReviewReply(review.id, tid, String(body.text ?? ""), "draft", auto);
      return NextResponse.json({ review: saved });
    }
    if (body.action === "post") {
      const text = body.text !== undefined ? String(body.text) : (review.replyText ?? "");
      if (!text.trim()) return NextResponse.json({ error: "Nothing to post — draft a reply first" }, { status: 400 });
      // Phase 1: we only record it as posted (you paste it into Google). Phase 2
      // will actually PUT the reply via the Google Business Profile API here.
      const saved = await setReviewReply(review.id, tid, text, "posted", auto);
      return NextResponse.json({ review: saved });
    }
    if (body.action === "unpost") {
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
