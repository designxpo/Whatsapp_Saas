// Signal scan — turn a page's visible posts/comments into a reviewable list of
// high-intent leads (someone asking for a recommendation, complaining about a
// tool, comparing options, asking about pricing).
//
// COMPLIANCE: nothing here runs on its own. The popup injects a collector only
// when the tenant clicks "Find leads", on the tab they're looking at, and the
// results are only ever PROPOSED — nothing is saved anywhere; each row offers a
// draft to copy, never an auto-send. This module is pure: no DOM, no network,
// no chrome APIs.
//
// The collector hands us loose candidates ({ platform, author, text, permalink });
// everything below decides which of them reads as a real buying signal.

/** @typedef {{ category: string, label: string, re: RegExp }} IntentPattern */

/** @type {IntentPattern[]} */
const INTENT_PATTERNS = [
  {
    category: "recommendation-ask",
    label: "Asking for a recommendation",
    re: /\b(anyone know|anyone recommend|can (?:you|anyone) recommend|looking for (?:a|an|some)|any (?:good )?recommendations? for|suggest (?:a|an|some)|what(?:'s| is) the best)\b/i,
  },
  {
    category: "pain-point",
    label: "Frustrated with a current tool",
    re: /\b(so frustrated (?:with|by)|so annoyed (?:with|by)|sick (?:and tired )?of|tired of|hate how|hate that|fed up with|driving me (?:crazy|insane)|why (?:does|is|won't|doesn't))\b/i,
  },
  {
    category: "switching-intent",
    label: "Considering switching",
    re: /\b(alternatives? to|switching from|switch(?:ing)? away from|migrat(?:e|ing) (?:from|away from)|worth switching|looking to (?:move|switch) (?:away )?from)\b/i,
  },
  {
    category: "evaluating",
    label: "Evaluating options",
    re: /\b(has anyone (?:used|tried)|thinking (?:about|of) (?:buying|trying)|is it worth (?:it|the)|which (?:one|tool|app) should i|worth (?:it|the money|the price)|\w+ vs\.? \w+)\b/i,
  },
  {
    category: "budget-question",
    label: "Asking about pricing",
    re: /\b(how much (?:does|should|would|is|will)\b.*?\bcost\b|pricing for|budget for|what(?:'s| is| does)? .{0,20}(?:cost|charge)|is there a free (?:plan|tier|version))\b/i,
  },
];

export const SIGNAL_LIMIT = 40;         // rows we show; a feed can hold hundreds

// Split into sentences so the snippet is the specific line that matched, not
// the whole post — a 400-word comment with one relevant line shouldn't force
// the reader to hunt for it.
/** @param {string} text */
function sentences(text) {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'])|[\n\r]+/)
    .map(s => s.trim())
    .filter(Boolean);
}

/** @param {string} s @param {number} [max] */
function clip(s, max = 200) {
  const t = String(s ?? "").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** @typedef {{ category: string, label: string, snippet: string } | null} SignalScore */

// A page fragment → the intent category it reads as, or null when it clearly
// isn't one. Checked sentence-by-sentence so the snippet quotes the specific
// line, then patterns in declaration order so the first (most specific) match
// wins when a post could read as more than one category.
/** @param {string} text @returns {SignalScore} */
export function scoreSignal(text) {
  const pieces = sentences(text);
  if (!pieces.length) return null;

  for (const { category, label, re } of INTENT_PATTERNS) {
    const hit = pieces.find(p => re.test(p));
    if (hit) return { category, label, snippet: clip(hit) };
  }
  return null;
}

/** @typedef {{ platform?: string, author?: string, text?: string, permalink?: string }} Candidate */
/** @typedef {{ platform: string, author: string, text: string, permalink: string, category: string, label: string, snippet: string }} Signal */

// Candidates → de-duplicated, human-reviewable signals, in page order.
/** @param {Candidate[]} candidates @param {{ limit?: number }} [opts] */
export function signalsFromCandidates(candidates, { limit = SIGNAL_LIMIT } = {}) {
  const seen = new Set();
  /** @type {Signal[]} */
  const all = [];

  for (const c of Array.isArray(candidates) ? candidates : []) {
    const text = String(c?.text ?? "").trim();
    if (!text) continue;
    const score = scoreSignal(text);
    if (!score) continue;

    const permalink = String(c?.permalink ?? "").trim();
    const author = String(c?.author ?? "").trim();
    // The same post can surface twice (e.g. once in a feed, once expanded) —
    // key on its permalink when the platform gave us one, else on who said it
    // plus the start of what they said.
    const key = permalink || `${author.toLowerCase()}::${text.slice(0, 80).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    all.push({
      platform: String(c?.platform ?? "web"),
      author,
      text,
      permalink,
      ...score,
    });
  }

  return { signals: all.slice(0, Math.max(0, limit)), total: all.length };
}
