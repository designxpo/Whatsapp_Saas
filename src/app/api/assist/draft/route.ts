import { NextResponse } from "next/server";
import { apiKeyTenant } from "@/lib/apiauth";
import { generateReviewReply } from "@/lib/llm";
import { AiKeyMissingError } from "@/lib/ai/keys";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // LLM call

// POST /api/assist/draft — draft a SHORT public reply to a review or a
// social/video comment the tenant is answering (e.g. from the browser
// extension's overlay on Google Business / YouTube). The tenant reads and posts
// it themselves — nothing is published from here. Grounded ONLY in the supplied
// text; never invents facts. Auth: Authorization: Bearer <ak_live_… key>.
//
// Body: { text, author?, kind?: "review" | "comment", rating?, businessName?, tone? }
export async function POST(req: Request) {
  const tenantId = await apiKeyTenant(req);
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: { text?: string; author?: string; kind?: string; rating?: number; businessName?: string; tone?: string; signature?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const text = (body.text ?? "").trim();
  if (!text) return NextResponse.json({ error: "text required" }, { status: 400 });
  if (text.length > 4000) return NextResponse.json({ error: "text too long" }, { status: 400 });

  const kind = body.kind === "comment" ? "comment" : "review";
  // Reviews carry a star rating; comments don't — default to a warm, neutral tone.
  const rating = Number.isFinite(body.rating) ? Number(body.rating) : kind === "comment" ? 4 : 3;
  const tone = body.tone
    || (kind === "comment"
      ? "This is a public comment on a video/post, not a star review. Reply naturally: answer questions plainly, thank compliments, and address concerns kindly. No hashtags."
      : undefined);

  try {
    const suggestion = await generateReviewReply(
      { author: body.author, rating, text, businessName: body.businessName, tone, signature: body.signature },
      tenantId,
    );
    return NextResponse.json({ suggestion, kind });
  } catch (err) {
    const busy = err instanceof Error && /AI_BUSY/.test(err.message);
    const msg = err instanceof AiKeyMissingError ? "AI isn't configured for this workspace."
      : busy ? "AI is busy right now (model overloaded) — try again."
      : "Could not draft a reply.";
    return NextResponse.json({ error: msg }, { status: busy ? 503 : 500 });
  }
}
