export const maxDuration = 60;
import { NextResponse } from "next/server";
import { generateReply, FALLBACK_REPLY, applyPersonaTone } from "@/lib/llm";
import { retrieve } from "@/lib/kb";
import { matchFaq } from "@/lib/router/faq";
import { cacheLookup, cacheStore } from "@/lib/router/cache";
import { routerEnabled } from "@/lib/router";
import { currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";

export const dynamic = "force-dynamic";

// POST — dry-run the assistant on a question WITHOUT sending anything on WhatsApp.
// Walks the same path as production: FAQ router → semantic cache → RAG fallback.
// Body: { question, skipRouter?, agentId? } — skipRouter forces the raw RAG
// path; agentId tests a specific AI Hub agent persona.
export async function POST(req: Request) {
  let body: { question?: string; skipRouter?: boolean; agentId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const question = body.question?.trim();
  if (!question) return NextResponse.json({ error: "question required" }, { status: 400 });

  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    let queryEmbedding: number[] | null = null;

    if (routerEnabled() && !body.skipRouter && !body.agentId) {
      const faqHit = matchFaq(question);
      if (faqHit) {
        return NextResponse.json({
          reply: await applyPersonaTone(faqHit.faq.detailedAnswer, question, null, tid), escalate: false, reason: null, usedChunks: 0,
          routedBy: "faq", faqId: faqHit.faq.id, faqQuestion: faqHit.faq.question,
          confidence: Number(faqHit.confidence.toFixed(3)), tier: faqHit.tier, retrieved: [],
        });
      }
      const { hit, embedding } = await cacheLookup(question, null, tid).catch(() => ({ hit: null, embedding: null }));
      queryEmbedding = embedding;
      if (hit) {
        return NextResponse.json({
          reply: await applyPersonaTone(hit.answer, question, null, tid), escalate: false, reason: null, usedChunks: 0,
          routedBy: "cache", confidence: Number(hit.similarity.toFixed(3)), retrieved: [],
        });
      }
    }

    // RAG fallback — surface the retrieval picture alongside the answer.
    const chunks = await retrieve(question, 6, tid).catch(() => []);
    const result = await generateReply([{ role: "user", body: question }], undefined, body.agentId ?? null, tid);
    if (!result.escalate && result.reply && result.reply.trim() !== FALLBACK_REPLY) {
      void cacheStore(question, result.reply, queryEmbedding, "rag", tid);
    }
    return NextResponse.json({
      reply: result.reply,
      escalate: result.escalate,
      reason: result.reason ?? null,
      usedChunks: result.usedChunks,
      routedBy: "rag",
      retrieved: chunks.map(c => ({ similarity: Number(c.similarity.toFixed(3)), preview: c.content.slice(0, 160) })),
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
