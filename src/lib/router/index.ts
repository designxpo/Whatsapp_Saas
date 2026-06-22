import { DEFAULT_TENANT_ID } from "../tenant";
// Knowledge Router — orchestrates the layers that sit BEFORE the existing RAG
// pipeline. RAG (lib/llm.ts + lib/kb.ts) is untouched and remains the fallback.
//
//   message → 1. memory follow-up → 2. FAQ index → 3. semantic cache → null (caller runs RAG)
//
// On a routed answer the caller skips RAG entirely. On a miss the caller runs
// generateReply() as before and should call recordRagAnswer() with the result
// so the semantic cache warms up over time.

import { FALLBACK_REPLY, SOFT_FALLBACK, CLARIFY_REPLY, applyPersonaTone } from "@/lib/llm";
import { kbCoverage } from "@/lib/kb";
import { matchFaq } from "./faq";
import { cacheLookup, cacheStore } from "./cache";
import { loadMemory, saveMemory, resolveFollowUp, type ConvMemory } from "./memory";
import { logRouterEvent } from "./metrics";

// A canned answer that withholds the specifics and redirects to a human
// ("contact our admissions team", "speak to a counsellor", "we'll get back to
// you"). When one of these is about to be served BUT the knowledge base actually
// has the answer, we defer to the KB instead — the KB is the source of truth and
// a handoff is the last resort, never the default. (If the KB has nothing, the
// deflection still stands, which keeps us honest when the KB is empty.)
const DEFLECTION_RE = /\b(?:counsell?or|admissions?\s+(?:team|advisor|counsell?or|department)|(?:speak|talk|connect|chat|get\s+in\s+touch)\s+(?:to|with)\s+(?:an?\s+|our\s+|the\s+)?(?:counsell?or|advisor|team|expert|admissions|representative|executive|agent|someone)|(?:will|to)\s+reach\s+out|reach\s+out\s+to\s+you|get\s+back\s+to\s+you|contact\s+(?:our\s+team|admissions|us)|book\s+a\s+(?:free\s+)?(?:career\s+)?consultation)\b/i;
export function looksLikeDeflection(answer: string): boolean {
  return DEFLECTION_RE.test(answer || "");
}


export interface RouteResult {
  answer: string | null;
  source: "memory" | "faq" | "cache" | null;   // null → fall back to RAG
  confidence?: number;
  faqId?: number;
  queryEmbedding: number[] | null;             // reuse for the cache write after RAG
}

export function routerEnabled(): boolean {
  return process.env.KNOWLEDGE_ROUTER_ENABLED !== "false";
}

export async function routeMessage(p: { conversationId: string; phone: string; message: string; agentId?: string | null; queryEmbedding?: number[] | null; tenantId?: string; contactName?: string | null }): Promise<RouteResult> {
  const t0 = Date.now();
  const tid = p.tenantId ?? DEFAULT_TENANT_ID;
  const miss: RouteResult = { answer: null, source: null, queryEmbedding: null };
  if (!routerEnabled()) return miss;

  // FAQ/cache answers are rewritten in the agent's persona voice before sending
  // (cheap one-shot call, falls back to the raw answer on any failure).
  const toned = (answer: string) => applyPersonaTone(answer, p.message, p.agentId ?? null, tid);

  let mem: ConvMemory = {};
  try { mem = await loadMemory(p.conversationId); } catch { /* memory is best-effort */ }

  // Layer 1 — conversation memory (follow-ups like "tell me more")
  const followUp = resolveFollowUp(p.message, mem);
  if (followUp) {
    logRouterEvent({ event: "MEMORY_HIT", phone: p.phone, question: p.message, ref: `faq:${followUp.id}`, latencyMs: Date.now() - t0 });
    return { answer: await toned(followUp.detailedAnswer), source: "memory", faqId: followUp.id, confidence: 1, queryEmbedding: null };
  }
  logRouterEvent({ event: "MEMORY_MISS", phone: p.phone, question: p.message, latencyMs: Date.now() - t0 });

  // Layer 2 — FAQ index (in-memory, no network)
  const faqHit = matchFaq(p.message, mem.lastCategory);
  if (faqHit) {
    // A deflecting FAQ answer (e.g. the "fees" entry that says "contact admissions")
    // must not shadow real KB content. If this tenant's KB covers the question, fall
    // through to RAG so the actual answer is served. The probe is only paid on the
    // rare deflection match, and reuses its embedding for the RAG cache write.
    if (looksLikeDeflection(faqHit.faq.detailedAnswer)) {
      const cov = await kbCoverage(p.message, tid).catch(() => null);
      if (cov?.covered) {
        logRouterEvent({ event: "FAQ_DEFLECT_OVERRIDE", phone: p.phone, question: p.message, ref: `faq:${faqHit.faq.id}→kb`, score: cov.top, latencyMs: Date.now() - t0 });
        return { ...miss, queryEmbedding: cov.embedding };
      }
    }
    logRouterEvent({ event: "FAQ_MATCH", phone: p.phone, question: p.message, ref: `faq:${faqHit.faq.id}:${faqHit.tier}`, score: faqHit.confidence, latencyMs: Date.now() - t0 });
    void saveMemory(p.conversationId, { lastFaqId: faqHit.faq.id, lastCategory: faqHit.faq.category, lastIntent: faqHit.faq.intentKeywords?.[0] });
    return { answer: await toned(faqHit.faq.detailedAnswer), source: "faq", faqId: faqHit.faq.id, confidence: faqHit.confidence, queryEmbedding: null };
  }
  logRouterEvent({ event: "FAQ_MISS", phone: p.phone, question: p.message, latencyMs: Date.now() - t0 });

  // Layer 3 — global semantic cache (one embedding call, no generation)
  try {
    const { hit, embedding } = await cacheLookup(p.message, p.queryEmbedding, tid, p.contactName);
    if (hit) {
      // Same guard as the FAQ layer: a previously-cached deflection must not
      // shadow KB content that now answers the question. Reuses the lookup's
      // embedding for the probe, so no extra embedding call.
      if (looksLikeDeflection(hit.answer)) {
        const cov = await kbCoverage(p.message, tid, embedding).catch(() => null);
        if (cov?.covered) {
          logRouterEvent({ event: "CACHE_DEFLECT_OVERRIDE", phone: p.phone, question: p.message, ref: `cache:${hit.id}→kb`, score: cov.top, latencyMs: Date.now() - t0 });
          return { ...miss, queryEmbedding: embedding };
        }
      }
      logRouterEvent({ event: "CACHE_HIT", phone: p.phone, question: p.message, ref: `cache:${hit.id}${hit.exact ? ":exact" : ""}`, score: hit.similarity, latencyMs: Date.now() - t0 });
      return { answer: await toned(hit.answer), source: "cache", confidence: hit.similarity, queryEmbedding: embedding };
    }
    logRouterEvent({ event: "CACHE_MISS", phone: p.phone, question: p.message, latencyMs: Date.now() - t0 });
    return { ...miss, queryEmbedding: embedding };
  } catch (e) {
    // Cache layer down (DB/embedding hiccup) — degrade straight to RAG.
    console.error("[router] cache layer failed, falling through to RAG:", e);
    return miss;
  }
}

// Call after the RAG fallback produced a real (non-escalation) answer.
// The generic FALLBACK_REPLY (returned on LLM API errors) must never be cached —
// it would permanently shadow the real answer for that question.
export function recordRagAnswer(p: { phone: string; question: string; answer: string; queryEmbedding: number[] | null; tenantId?: string; contactName?: string | null }): void {
  logRouterEvent({ event: "RAG_USED", phone: p.phone, question: p.question });
  // Generic non-answers (API-error fallback, empty/ambiguous nudges) must never be
  // cached. `contactName` lets cacheStore refuse a name-personalised answer.
  const a = p.answer.trim();
  if (a === FALLBACK_REPLY || a === SOFT_FALLBACK || a === CLARIFY_REPLY) return;
  void cacheStore(p.question, p.answer, p.queryEmbedding, "rag", p.tenantId ?? DEFAULT_TENANT_ID, p.contactName);
}
