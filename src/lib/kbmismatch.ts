// Where two sources state different numbers for the same thing.
//
// ── Why this is separate from reconcile() ───────────────────────────────────
//
// Source precedence HIDES disagreements. A brochure that contradicts the
// website is refused automatically, which is right for the assistant and wrong
// for the brochure: nobody learns it is stale, and it stays stale in every PDF
// that goes out. Precedence decides what gets answered; this decides what
// somebody has to go and fix.
//
// ── Why it matches on facts, not on paths ───────────────────────────────────
//
// reconcile() compares two concepts when they land on the same path, and paths
// come from headings. The two documents that disagree almost never share a
// heading — "Fees" and "Plan Investment" never collide — so a path-based
// check reports nothing while the numbers differ.
//
// So the comparison is between FACTS: an item's price in a named column, a
// duration, a placement rate. Those are comparable wherever they were written.
import { parseTables, tableFacts } from "./okffacts";
import { sourceRank } from "./kblibrary";
import { normLabel } from "./leadtokens";

export interface MismatchInput {
  path: string;
  source: string;
  tags: string[];
  body: string;
  /** The concept's title: the subject for a table that names only modes. */
  title?: string;
}

export interface Claim {
  value: string;
  source: string;
  path: string;
  rank: number;
}

export interface Mismatch {
  /** The thing being described — an item, or an area for scalar facts. */
  subject: string;
  /** Which number about it: a fee column, duration_months, placement_pct. */
  field: string;
  claims: Claim[];
  /** The value the source ranking favours. */
  preferred: string;
  /** The claims that disagree with it — the documents to correct. */
  stale: Claim[];
}

/**
 * One key per item, however it is spelled.
 *
 * "Data Analytics & AI Program" and "Data Analytics & AI Programme" are the same
 * course. Split apart, a real conflict between
 * them reads as two separate facts that each agree with themselves.
 *
 * Every name is reduced to a normalised string, which makes punctuation and case
 * irrelevant.
 */
function subjectKey(name: string): string {
  // Normalise and take ONE path only: two spellings of the same name must reach the
  // same key, or the conflict between them disappears into two separate subjects
  // that each agree with themselves.
  const n = normLabel(name)
    // A trailing "program"/"programme" varies between documents and carries no meaning here.
    .replace(/\s+(training\s+)?program(me)?$/, "")
    .trim();
  return n || name.trim();
}

/** Collect every comparable number, tagged with where it came from. */
function claimsFrom(inputs: MismatchInput[]): Map<string, Claim[]> {
  const out = new Map<string, Claim[]>();
  const add = (subject: string, field: string, value: string, c: MismatchInput) => {
    const key = `${subject}\u0000${field}`;
    const list = out.get(key) ?? [];
    list.push({ value, source: c.source, path: c.path, rank: sourceRank(c.source, c.tags) });
    out.set(key, list);
  };

  for (const c of inputs) {
    for (const t of parseTables(c.body)) {
      // A table that names items prices itself. One that names delivery
      // modes needs the course from outside, and the concept's own title is
      // where it lives — that is how the brochure's fees get cross-checked at
      // all. tableFacts yields nothing when neither is available, so a price
      // is never attached to a course nobody identified.
      for (const f of tableFacts(t, { subject: c.title ?? "" })) {
        for (const [col, amount] of Object.entries(f.prices)) {
          add(subjectKey(f.subject), `price:${col}`, String(amount), c);
        }
      }
    }

    // Organisation-wide claims, compared across the whole library because
    // that is the scope they are made at: there is one placement rate and one
    // refund rule, not one per area.
    //
    // Duration and course fees are deliberately NOT compared this way. They
    // belong to a course, and an area holds many courses — comparing every
    // duration in "plans" reports 6 against 15 against 8 as a conflict when
    // it is simply three different items.
    const placement = c.body.match(/(\d{1,3})\s*%\s*\+?\s*(?:placement|placed)/i);
    if (placement) add("the business", "placement_pct", placement[1], c);
    const refund = c.body.match(/(\d{1,3})\s*%\s*(?:fee\s*)?refund/i);
    if (refund) add("the business", "refund_pct", refund[1], c);
  }

  return out;
}

/**
 * Every fact two sources disagree about, worst first.
 *
 * "Worst" is how many sources are involved: a figure three documents state
 * three ways is a bigger problem than one two documents disagree on, and
 * whoever works this list should meet it first.
 */
export function findMismatches(inputs: MismatchInput[]): Mismatch[] {
  const out: Mismatch[] = [];

  for (const [key, claims] of claimsFrom(inputs)) {
    const values = new Set(claims.map(c => c.value));
    if (values.size < 2) continue;

    const [subject, field] = key.split("\u0000");
    // Best-ranked claim wins; ties go to the first seen, which keeps the
    // report stable between runs.
    const best = [...claims].sort((a, b) => a.rank - b.rank)[0];

    out.push({
      subject,
      field,
      claims,
      preferred: best.value,
      stale: claims.filter(c => c.value !== best.value),
    });
  }

  return out.sort((a, b) =>
    b.claims.length - a.claims.length ||
    a.subject.localeCompare(b.subject) ||
    a.field.localeCompare(b.field));
}
