// Semantic Cache — Layer 2 of the Knowledge Router. Scoped per tenant.
// Two-step lookup: free exact-normalized-text hit first, then pgvector cosine
// similarity (one embedding call — still far cheaper than a full RAG pass).

import { db } from "@/lib/supabase";
import { embedQuery } from "@/lib/kb";
import { normalize } from "./faq";

const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000001";

// Paraphrase-level similarity. Below this we risk serving a wrong cached answer.
const CACHE_SIMILARITY = 0.92;

export interface CacheHit {
  id: string;
  answer: string;
  similarity: number;
  exact: boolean;
}

export interface CacheLookup {
  hit: CacheHit | null;
  embedding: number[] | null;   // returned so the RAG path can reuse it for the write
}

export async function cacheLookup(question: string, precomputed?: number[] | null, tenantId = DEFAULT_TENANT_ID): Promise<CacheLookup> {
  const norm = normalize(question);
  if (!norm) return { hit: null, embedding: null };

  // Step 1 — exact normalized text (no embedding call), scoped to the tenant.
  const exact = await db().from("wa_semantic_cache")
    .select("id, answer").eq("tenant_id", tenantId).eq("normalized_question", norm).maybeSingle();
  if (exact.data) {
    void bumpHit(exact.data.id as string);
    return { hit: { id: exact.data.id as string, answer: exact.data.answer as string, similarity: 1, exact: true }, embedding: null };
  }

  // Step 2 — vector similarity (reuse the caller's embedding when provided).
  const embedding = precomputed ?? await embedQuery(question);
  const { data } = await db().rpc("match_semantic_cache", { query_embedding: embedding, match_count: 1, p_tenant_id: tenantId });
  const top = (data as { id: string; answer: string; similarity: number }[] | null)?.[0];
  if (top && top.similarity >= CACHE_SIMILARITY) {
    void bumpHit(top.id);
    return { hit: { id: top.id, answer: top.answer, similarity: top.similarity, exact: false }, embedding };
  }
  return { hit: null, embedding };
}

async function bumpHit(id: string): Promise<void> {
  try {
    const { data } = await db().from("wa_semantic_cache").select("hit_count").eq("id", id).single();
    await db().from("wa_semantic_cache")
      .update({ hit_count: ((data?.hit_count as number) ?? 0) + 1, last_used_at: new Date().toISOString() })
      .eq("id", id);
  } catch { /* metrics only — never block the reply */ }
}

// Store a RAG-produced answer. Reuses the lookup's embedding when available.
// The cache is tenant-scoped — answers must never cross tenants.
export async function cacheStore(question: string, answer: string, embedding: number[] | null, source = "rag", tenantId = DEFAULT_TENANT_ID): Promise<void> {
  try {
    const norm = normalize(question);
    if (!norm || !answer.trim()) return;
    const emb = embedding ?? await embedQuery(question);
    // Unique on (tenant_id, normalized_question) — concurrent dup inserts no-op.
    await db().from("wa_semantic_cache").upsert(
      { tenant_id: tenantId, question, normalized_question: norm, answer, source, embedding: emb },
      { onConflict: "tenant_id,normalized_question", ignoreDuplicates: true },
    );
  } catch (e) {
    console.error("[router] cacheStore failed:", e);
  }
}
