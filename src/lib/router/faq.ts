// FAQ Router — Layer 1 of the Knowledge Router. Pure in-memory matching against
// the curated FAQ dataset; zero network calls, sub-millisecond, deterministic.
//
// Matching tiers (first hit wins):
//   1. Exact match     — normalized question == normalized FAQ question/phrasing
//   2. Phrasing match  — high token-set overlap with a question/phrasing (≥0.85)
//   3. Keyword match   — weighted scoring over intentKeywords (3x), synonyms (2x),
//                        question tokens (1x), accepted above MATCH_THRESHOLD

import faqData from "@/data/faq.json";

export interface FaqEntry {
  id: number;
  category: string;
  question: string;
  shortAnswer: string;
  detailedAnswer: string;
  intentKeywords: string[];
  synonyms: string[];
  alternativePhrasings: string[];
}

export interface FaqMatch {
  faq: FaqEntry;
  confidence: number;            // 0..1
  tier: "exact" | "phrasing" | "keyword";
}

const MATCH_THRESHOLD = 0.55;    // keyword-tier acceptance
const PHRASING_THRESHOLD = 0.85; // token-set overlap for tier 2

const STOPWORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "do", "does", "did", "can", "could",
  "will", "would", "should", "i", "me", "my", "we", "our", "you", "your", "it", "its",
  "of", "in", "on", "at", "to", "for", "with", "about", "and", "or", "what", "which",
  "who", "how", "when", "where", "why", "there", "this", "that", "these", "those",
  "tell", "know", "want", "please", "get", "have", "has", "be", "am", "any", "some",
]);

export function normalize(s: string): string {
  return (s || "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

function tokens(s: string): string[] {
  return normalize(s).split(" ").filter(t => t && !STOPWORDS.has(t));
}

// ── Index built once at module load (cold start) ──────────────────────────────
const FAQS = faqData as FaqEntry[];

const exactIndex = new Map<string, FaqEntry>();          // normalized question/phrasing → faq
const phrasingIndex: { tokenSet: Set<string>; faq: FaqEntry }[] = [];
const keywordIndex: { faq: FaqEntry; keywords: Set<string>; keywordPhrases: string[]; synonyms: Set<string>; synonymPhrases: string[]; qTokens: Set<string> }[] = [];

for (const faq of FAQS) {
  const variants = [faq.question, ...(faq.alternativePhrasings ?? [])];
  for (const v of variants) {
    const n = normalize(v);
    if (n && !exactIndex.has(n)) exactIndex.set(n, faq);
    const ts = new Set(tokens(v));
    if (ts.size >= 2) phrasingIndex.push({ tokenSet: ts, faq });
  }
  const kw = (faq.intentKeywords ?? []).map(normalize).filter(Boolean);
  const syn = (faq.synonyms ?? []).map(normalize).filter(Boolean);
  // Multiword keywords/synonyms are indexed both as phrases (bonus weight) and
  // as individual tokens, so "working people" still reaches "working professionals".
  keywordIndex.push({
    faq,
    keywords: new Set(kw.flatMap(k => k.split(" "))),
    keywordPhrases: kw.filter(k => k.includes(" ")),
    synonyms: new Set(syn.flatMap(s => s.split(" "))),
    synonymPhrases: syn.filter(s => s.includes(" ")),
    qTokens: new Set(tokens(faq.question)),
  });
}

// Global vocabulary — every token any FAQ knows about. Query tokens outside it
// (chat filler like "guys", "bhai") are excluded from scoring so they don't
// dilute the match score of conversational messages.
const VOCAB = new Set<string>();
for (const e of keywordIndex) {
  for (const t of e.keywords) VOCAB.add(t);
  for (const t of e.synonyms) VOCAB.add(t);
  for (const t of e.qTokens) VOCAB.add(t);
}

export function faqCount(): number { return FAQS.length; }
export function getFaqById(id: number): FaqEntry | undefined { return FAQS.find(f => f.id === id); }

function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n;
}

// Match a user message against the FAQ index. categoryBoost (from conversation
// memory) relaxes the keyword threshold for FAQs in the user's current topic.
export function matchFaq(message: string, categoryBoost?: string | null): FaqMatch | null {
  const norm = normalize(message);
  if (!norm) return null;

  // Tier 1 — exact
  const exact = exactIndex.get(norm);
  if (exact) return { faq: exact, confidence: 1, tier: "exact" };

  const qTokens = new Set(tokens(message));
  if (qTokens.size === 0) return null;

  // Tier 2 — phrasing overlap (Jaccard-ish, sized to the shorter set)
  let bestPhr: FaqMatch | null = null;
  for (const { tokenSet, faq } of phrasingIndex) {
    const inter = overlap(qTokens, tokenSet);
    const score = inter / Math.min(qTokens.size, tokenSet.size) * (inter / Math.max(qTokens.size, tokenSet.size)) ** 0.3;
    if (score >= PHRASING_THRESHOLD && (!bestPhr || score > bestPhr.confidence)) {
      bestPhr = { faq, confidence: Math.min(score, 0.99), tier: "phrasing" };
    }
  }
  if (bestPhr) return bestPhr;

  // Tier 3 — weighted keyword/synonym scoring over vocabulary tokens only.
  // Long multi-clause messages ("I am Ramesh from Mumbai, I want to join…")
  // are conversations, not FAQ lookups — those belong to the agent/LLM, which
  // can also run function-calling lead capture on them.
  if (qTokens.size > 12) return null;
  const effTokens = [...qTokens].filter(t => VOCAB.has(t));
  if (effTokens.length === 0) return null;
  const denom = Math.max(2, effTokens.length) * 3;           // max possible weight

  let best: FaqMatch | null = null;
  for (const e of keywordIndex) {
    let weighted = 0;
    let hits = 0;
    for (const t of effTokens) {
      if (e.keywords.has(t)) { weighted += 3; hits++; }
      else if (e.synonyms.has(t)) { weighted += 2; hits++; }
      else if (e.qTokens.has(t)) { weighted += 1; hits++; }
    }
    for (const p of e.keywordPhrases) if (norm.includes(p)) { weighted += 4; hits++; }
    for (const p of e.synonymPhrases) if (norm.includes(p)) { weighted += 3; hits++; }
    if (hits < 2) continue;                                  // require ≥2 distinct signals
    const score = weighted / denom;
    const threshold = e.faq.category === categoryBoost ? MATCH_THRESHOLD * 0.75 : MATCH_THRESHOLD;
    if (score >= threshold && (!best || score > best.confidence)) {
      best = { faq: e.faq, confidence: Math.min(score, 0.95), tier: "keyword" };
    }
  }
  return best;
}
