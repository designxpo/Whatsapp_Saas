import { NextResponse } from "next/server";
import { getReviewSettings } from "@/lib/reviews";
import { decideAutoPost, normalizeHoldFor, type AiRead } from "@/lib/review-policy";
import { draftReviewReply } from "@/lib/llm";
import { currentTenantId, requireRoleAdmin, DEFAULT_TENANT_ID } from "@/lib/auth";
import { guardFeature } from "@/lib/feature-guard";
import { AiKeyMissingError } from "@/lib/ai/keys";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST { rating, text, withAi?, autoMinStars?, holdFor? } — what the reply
// rules would do with a sample review, using the settings being edited (or the
// saved ones). Nothing is saved and nothing is posted anywhere. With withAi,
// the AI also drafts a sample reply, exactly as it would for a real review.
export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  const gate = await guardFeature(tid, "reviews");
  if (gate) return gate;
  let body: { rating?: number; text?: string; withAi?: boolean; autoMinStars?: number; holdFor?: unknown; author?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const rating = Math.min(5, Math.max(1, Math.round(Number(body.rating) || 5)));
  const text = String(body.text ?? "").slice(0, 2000);
  const saved = await getReviewSettings(tid);
  const autoMinStars = Number.isFinite(Number(body.autoMinStars)) ? Math.min(6, Math.max(1, Math.round(Number(body.autoMinStars)))) : saved.autoMinStars;
  const holdFor = body.holdFor ? normalizeHoldFor(body.holdFor) : saved.holdFor;

  let ai: AiRead | null = null;
  let reply: string | null = null;
  let aiNote: string | null = null;
  if (body.withAi) {
    try {
      const d = await draftReviewReply({ author: String(body.author ?? "Priya"), rating, text, tone: saved.tone, signature: saved.signature }, tid);
      ai = d.ai; reply = d.reply;
    } catch (e) {
      aiNote = e instanceof AiKeyMissingError ? "Add an AI key in AI Hub to preview AI replies." : /AI_BUSY/.test(e instanceof Error ? e.message : "") ? "The AI is busy or out of quota right now — the rules below still apply." : "The AI couldn't draft a sample reply right now.";
    }
  }
  const decision = decideAutoPost({ rating, text, autoMinStars, holdFor, ai: body.withAi ? ai : { concerns: [], confident: true } });
  return NextResponse.json({
    autoPost: decision.autoPost, reasons: decision.reasons, topics: decision.topics, complaint: decision.complaint,
    reply, aiNote, aiChecked: !!body.withAi,
    note: body.withAi ? null : "Phrase rules only. For a real review the AI also reads it, and anything it flags or isn't sure about waits for approval.",
  });
}
