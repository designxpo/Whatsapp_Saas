// Questions the AI couldn't answer — so the knowledge base gets better every
// week instead of the same question getting "a team member will reply" forever.
//
// Recorded from generateReply (llm.ts), the one path every channel's AI reply
// takes: when the AI hands off because the knowledge base doesn't cover a real
// question, or can only ask for more detail. NOT when the customer asked for a
// person or complained (the AI did the right thing), and not for greetings,
// errors, a missing key or practice runs (tests, simulators, drafts).
//
// Phrasings of the same question are grouped by a normalised key. Answering a
// group adds a knowledge-base entry (question + answer, ingested like any text
// document) and resolves every phrasing; dismissing hides it.

import { tdb } from "./tenantdb";
import { createDocument } from "./store";
import { ingestDocument } from "./kb";
import { errorMessage } from "./errors";

const TABLE = "wa_ai_gaps";
export const SETUP_HINT = "This list isn't set up in the database yet. Apply migration 20261101180000_gaps_reviews.sql in Supabase, then reload.";

// Asking for a person, or a complaint: handing off was the right answer, not a gap.
const HANDOFF_RE = /\b(agent|human|representative|executive|manager|complaint|refund|cancel|angry|frustrat|useless|worst|scam|fraud|call\s*me|call\s*back|talk to|speak to|connect me|real person|customer care)\b/i;
// Too short or empty to be a question worth answering in the knowledge base.
const TRIVIAL_RE = /^(hi+|hello+|hey+|ok+|okay|thanks?|thank you|ty|yes|no|hmm+|\?+|\.+|👍|🙏)$/i;

/** Why a reply is a knowledge gap, or null when it isn't one. Pure. */
export function knowledgeGapReason(result: { reply: string | null; escalate: boolean; reason?: string }, question: string, softFallback: string): string | null {
  const q = (question || "").trim();
  if (q.length < 6 || TRIVIAL_RE.test(q) || HANDOFF_RE.test(q)) return null;
  if (result.escalate && (result.reason === "model escalated" || result.reason === "second consecutive non-answer — handing off")) return "handed off";
  if (!result.escalate && result.reply === softFallback && result.reason === "empty model reply") return "asked for more detail";
  return null;
}

/** The grouping key for a question: same words, any case, punctuation or emoji. Pure. */
export function questionKey(q: string): string {
  return q.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 160);
}

/** Note a question the AI couldn't answer. Never throws, never delays the reply. */
export function recordGap(g: { tenantId: string; platform: string; question: string; reason: string; phone?: string | null }): void {
  const key = questionKey(g.question);
  if (!key) return;
  void Promise.resolve(tdb(g.tenantId).from(TABLE).insert({
    platform: g.platform, question: g.question.trim().slice(0, 1000), question_key: key, reason: g.reason, phone: g.phone ?? null,
  })).then(({ error }) => { if (error) console.warn("[ai-gaps] record failed:", error.message); }, e => console.warn("[ai-gaps] record failed:", errorMessage(e)));
}

export interface GapGroup { key: string; question: string; count: number; lastAt: string; platforms: string[]; reasons: string[] }

const RANGES = [7, 30, 90];

/** Open gaps in the last `days`, grouped, most-asked first. Bounded: the newest 2,000 rows. */
export async function listGaps(tenantId: string, days = 30): Promise<{ groups: GapGroup[]; setupNeeded?: string }> {
  const d = RANGES.includes(days) ? days : 30;
  const since = new Date(Date.now() - d * 86_400_000).toISOString();
  const { data, error } = await tdb(tenantId).from(TABLE).select("question,question_key,platform,reason,created_at")
    .is("resolved_at", null).gte("created_at", since).order("created_at", { ascending: false }).limit(2000);
  if (error) {
    if (/wa_ai_gaps|schema cache|does not exist/i.test(error.message)) return { groups: [], setupNeeded: SETUP_HINT };
    throw new Error(error.message);
  }
  return { groups: groupGaps((data ?? []) as unknown as GapRow[]) };
}

type GapRow = { question: string; question_key: string; platform: string; reason: string; created_at: string };
/** Rows (newest first) → groups, most-asked first, ties by most recent. Pure. */
export function groupGaps(rows: GapRow[]): GapGroup[] {
  const by = new Map<string, GapGroup>();
  for (const r of rows) {
    const g = by.get(r.question_key);
    if (!g) { by.set(r.question_key, { key: r.question_key, question: r.question, count: 1, lastAt: r.created_at, platforms: [r.platform], reasons: [r.reason] }); continue; }
    g.count++;
    if (!g.platforms.includes(r.platform)) g.platforms.push(r.platform);
    if (!g.reasons.includes(r.reason)) g.reasons.push(r.reason);
  }
  return [...by.values()].sort((a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt));
}

/** Answer a group: a knowledge-base entry, then every phrasing of it resolved. */
export async function answerGap(tenantId: string, key: string, answer: string, actor: string, tag?: string | null): Promise<{ docId?: string; error?: string }> {
  const a = answer.trim();
  if (a.length < 3) return { error: "Write the answer first." };
  const { data } = await tdb(tenantId).from(TABLE).select("question").eq("question_key", key).is("resolved_at", null).order("created_at", { ascending: false }).limit(1);
  const question = ((data ?? []) as unknown as { question: string }[])[0]?.question;
  if (!question) return { error: "That question is no longer open." };
  const doc = await createDocument({ title: `Q&A: ${question.slice(0, 80)}`, sourceType: "text", sourceRef: "question-gap", tag: tag?.trim() || null }, tenantId);
  await ingestDocument(doc.id, "text", { text: `Question: ${question}\nAnswer: ${a}` }, tenantId);
  await tdb(tenantId).from(TABLE).update({ resolved_at: new Date().toISOString(), resolution: "answered", resolved_by: actor, kb_doc_id: doc.id }).eq("question_key", key).is("resolved_at", null);
  return { docId: doc.id };
}

export async function dismissGap(tenantId: string, key: string, actor: string): Promise<void> {
  await tdb(tenantId).from(TABLE).update({ resolved_at: new Date().toISOString(), resolution: "dismissed", resolved_by: actor }).eq("question_key", key).is("resolved_at", null);
}

/** For the morning digest: open questions from the last week. */
export async function gapsForDigest(tenantId: string): Promise<{ open: number; top: { question: string; count: number }[] }> {
  try {
    const { groups } = await listGaps(tenantId, 7);
    return { open: groups.length, top: groups.slice(0, 3).map(g => ({ question: g.question, count: g.count })) };
  } catch { return { open: 0, top: [] }; }
}

