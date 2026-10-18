import { DEFAULT_TENANT_ID } from "./tenant";
// Comparing the OKF library against the document index, before trusting it.
//
// ── What this can and cannot tell you ───────────────────────────────────────
//
// There is no labelled answer key. Nobody has written down what the correct
// passage is for "what is the fee", so nothing here can say the library is
// MORE ACCURATE than the chunks. Claiming otherwise would be the most
// expensive kind of wrong: a green number that licenses a cutover nobody
// actually checked.
//
// What it can establish, which is enough to make the decision safely:
//
//   COVERAGE   does the library find anything at all for a question the
//              document index answered? A question that went from answered to
//              unanswered is a regression, flatly, with no judgement needed.
//   AGREEMENT  when both find something, is it the same material? Where the
//              two disagree, a person reads those and only those.
//   SCORE      the similarity distribution, which says whether matches got
//              weaker — a proxy, and treated as one.
//
// The questions are real. They come from wa_router_events, which recorded what
// leads actually asked when retrieval ran, so the set reflects the traffic
// rather than what somebody imagined the assistant is for.
import { tdb } from "./tenantdb";
import { errorMessage } from "./errors";
import { retrieve } from "./kb";

export interface EvalCase {
  question: string;
  documents: { found: number; top: number; text: string };
  concepts: { found: number; top: number; text: string };
  /** 0–1 word overlap between what the two indexes returned. */
  agreement: number;
  /** Answered before, not answered now. The one unambiguous regression. */
  lost: boolean;
  /** Not answered before, answered now. */
  gained: boolean;
}

export interface EvalReport {
  cases: EvalCase[];
  total: number;
  coveredBefore: number;
  coveredAfter: number;
  lost: number;
  gained: number;
  /** Mean agreement where both indexes answered. */
  meanAgreement: number;
  /** Cases a person should read, worst agreement first. */
  needsReading: EvalCase[];
}

/**
 * Real questions leads asked, newest first.
 *
 * RAG_USED is the event logged when retrieval actually ran, so these are the
 * questions the knowledge base was genuinely consulted for — not FAQ hits or
 * cache hits, which never reached it.
 */
export async function goldenQuestions(limit = 200, tenantId = DEFAULT_TENANT_ID): Promise<string[]> {
  try {
    const { data } = await tdb(tenantId).from("wa_router_events")
      .select("question").eq("event", "RAG_USED")
      .order("created_at", { ascending: false }).limit(limit * 2);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const r of (data ?? []) as { question?: string | null }[]) {
      const q = String(r.question ?? "").trim();
      // Deduplicated case-insensitively: the same question asked forty times
      // should not weight the report forty-fold.
      const key = q.toLowerCase();
      if (q.length < 8 || seen.has(key)) continue;
      seen.add(key);
      out.push(q);
      if (out.length >= limit) break;
    }
    return out;
  } catch (err) {
    console.error("[kbeval] could not read questions:", errorMessage(err));
    return [];
  }
}

/** Word overlap, as a crude but honest "is this the same material" signal. */
export function agreementScore(a: string, b: string): number {
  const words = (s: string) => new Set(
    s.toLowerCase()
      // ₹, % and . survive the scrub so "₹6.5 lakh" stays one comparable
      // token rather than becoming "6" and "5".
      .replace(/[^a-z0-9₹%. ]/g, " ")
      .split(/\s+/)
      // A period that ends a sentence is not part of the word. Without this
      // "available" and "available." count as two different things and two
      // identical passages score half.
      .map(w => w.replace(/^\.+|\.+$/g, ""))
      .filter(w => w.length > 3),
  );
  const x = words(a), y = words(b);
  if (!x.size || !y.size) return 0;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return Number((shared / Math.max(x.size, y.size)).toFixed(3));
}

/**
 * Run every question against both indexes.
 *
 * Sequential, not parallel: each question costs an embedding call, and firing
 * two hundred at once is the reliable way to be rate-limited halfway through
 * and draw a conclusion from half a report.
 */
export async function runEval(questions?: string[], k = 6, tenantId = DEFAULT_TENANT_ID): Promise<EvalReport> {
  const qs = questions?.length ? questions : await goldenQuestions(undefined, tenantId);
  const cases: EvalCase[] = [];

  for (const question of qs) {
    const [docs, cons] = [
      await retrieve(question, k, tenantId, undefined, { index: "documents" }).catch(() => []),
      await retrieve(question, k, tenantId, undefined, { index: "concepts" }).catch(() => []),
    ];
    const dText = docs.map(d => d.content).join("\n");
    const cText = cons.map(c => c.content).join("\n");
    cases.push({
      question,
      documents: { found: docs.length, top: docs[0]?.similarity ?? 0, text: dText.slice(0, 400) },
      concepts: { found: cons.length, top: cons[0]?.similarity ?? 0, text: cText.slice(0, 400) },
      agreement: agreementScore(dText, cText),
      lost: docs.length > 0 && cons.length === 0,
      gained: docs.length === 0 && cons.length > 0,
    });
  }

  const both = cases.filter(c => c.documents.found && c.concepts.found);
  return {
    cases,
    total: cases.length,
    coveredBefore: cases.filter(c => c.documents.found > 0).length,
    coveredAfter: cases.filter(c => c.concepts.found > 0).length,
    lost: cases.filter(c => c.lost).length,
    gained: cases.filter(c => c.gained).length,
    meanAgreement: both.length
      ? Number((both.reduce((a, c) => a + c.agreement, 0) / both.length).toFixed(3))
      : 0,
    // Everything lost, then the weakest agreement. A reviewer works down this
    // list and stops when it stops being interesting; they never read 200 rows.
    needsReading: [...cases]
      .filter(c => c.lost || c.agreement < 0.5)
      .sort((a, b) => Number(b.lost) - Number(a.lost) || a.agreement - b.agreement)
      .slice(0, 25),
  };
}

/**
 * Is the library safe to switch on?
 *
 * Deliberately conservative and deliberately not a score. Losing coverage on a
 * question that used to be answered is disqualifying on its own, however good
 * the averages look, because it means a lead who would have got an answer now
 * gets silence.
 */
export function verdict(r: EvalReport): { ready: boolean; reason: string } {
  if (!r.total) return { ready: false, reason: "no questions to evaluate — nothing has been asked yet" };
  if (r.lost > 0) {
    return { ready: false, reason: `${r.lost} question${r.lost === 1 ? "" : "s"} the documents answered now return nothing` };
  }
  if (r.coveredAfter < r.coveredBefore) {
    return { ready: false, reason: `coverage dropped from ${r.coveredBefore} to ${r.coveredAfter} of ${r.total}` };
  }
  return {
    ready: true,
    reason: `coverage ${r.coveredAfter}/${r.total} (was ${r.coveredBefore}), ${r.gained} newly answered, mean agreement ${r.meanAgreement}. Read the ${r.needsReading.length} flagged cases before switching.`,
  };
}
