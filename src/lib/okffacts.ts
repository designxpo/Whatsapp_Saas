// Tables, and the numbers inside them.
//
// ── Why this exists ─────────────────────────────────────────────────────────
//
// The fee data is tabular: a programme down the side, a delivery mode across
// the top, a rupee figure in each cell. Flattened into prose and cut into
// 1,000-character windows, a cell loses its row and its column — the figure
// survives but "which programme, in which mode" does not, and an assistant
// reading it can honestly quote 70,800 for the wrong course.
//
// Lifting those cells into typed front-matter fields changes what can be
// checked. A price in prose is unverifiable; an answer saying "around 80,000"
// matches nothing and contradicts nothing. A price in `price_max_inr: 87320`
// is a fact with an address, so an answer either agrees with it or does not.
// That is the whole mechanism by which structure reduces hallucination: not
// that the model lies less, but that the lie becomes detectable.
//
// ── Indian notation ─────────────────────────────────────────────────────────
//
// "INR 1,08,560/-" is one lakh eight thousand five hundred and sixty. Stripping
// the commas gives the right answer for both Indian and Western grouping, which
// is why that is what happens here — the danger is not the grouping but reading
// "1,08,560" as 1.08 and then formatting it back out as something plausible.

export interface MdTable {
  headers: string[];
  rows: string[][];
}

const cells = (line: string): string[] =>
  line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|")
    // Exports wrap programme names in bold; the asterisks are markup, not name.
    .map(c => c.trim().replace(/^\*\*(.*)\*\*$/, "$1").replace(/^\*(.*)\*$/, "$1").trim());

const isSeparator = (line: string): boolean => /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(line) && line.includes("-");

/**
 * Every markdown table in a block of text.
 *
 * A table is a header row, a separator, then data — a lone pipe in a sentence
 * is not a table, and treating it as one would turn ordinary prose into
 * phantom rows.
 */
export function parseTables(md: string): MdTable[] {
  const lines = String(md ?? "").replace(/\r\n/g, "\n").split("\n");
  const out: MdTable[] = [];
  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].includes("|") || !isSeparator(lines[i + 1])) continue;
    const headers = cells(lines[i]);
    if (headers.length < 2) continue;
    const rows: string[][] = [];
    let j = i + 2;
    for (; j < lines.length && lines[j].includes("|") && lines[j].trim(); j++) {
      if (isSeparator(lines[j])) continue;
      const r = cells(lines[j]);
      // A short row keeps its place with blanks rather than being dropped —
      // losing a row silently is worse than carrying an empty cell.
      while (r.length < headers.length) r.push("");
      rows.push(r.slice(0, headers.length));
    }
    if (rows.length) out.push({ headers, rows });
    i = j - 1;
  }
  return out;
}

/** Years and small counts are not prices; "Not Offered" is not zero. */
export function parseMoney(raw: string): number | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;

  const word = s.match(/(\d{1,3}(?:\.\d+)?)\s*(lakh|lac|lpa)\b/i);
  if (word) return Math.round(parseFloat(word[1]) * 100_000);

  const tagged = s.match(/(?:₹|rs\.?|inr)\s*([\d,]+)/i);
  if (tagged) {
    const n = parseInt(tagged[1].replace(/,/g, ""), 10);
    return Number.isFinite(n) && n >= 1000 ? n : null;
  }

  // A bare number only counts when nothing else in the cell contradicts it:
  // "6 months" and "2026" are not prices.
  if (/month|week|year|%|\b(19|20)\d{2}\b/i.test(s)) return null;
  const bare = s.match(/^[\s]*([\d,]{4,})[\s/\-]*$/);
  if (bare) {
    const n = parseInt(bare[1].replace(/,/g, ""), 10);
    return Number.isFinite(n) && n >= 1000 && n <= 10_000_000 ? n : null;
  }
  return null;
}

// Parentheticals are kept: "Fee (incl. taxes)" becomes fee-incl-taxes, because
// whether tax is included is part of what the number means. Dropping it would
// leave two different prices competing for one field name.
const slug = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

export interface SubjectPrices {
  /** The row's label — usually a programme, sometimes a delivery mode. */
  subject: string;
  /** Column slug → rupees. A mode that is not offered is simply absent. */
  prices: Record<string, number>;
}

/**
 * The prices a table states, kept attached to the row they belong to.
 *
 * The attachment is the point. A loose list of figures is what the chunked
 * version already produces, and it is exactly what lets a fee be quoted
 * against the wrong course.
 */
export function tableFacts(table: MdTable, opts: { subject?: string } = {}): SubjectPrices[] {
  if (!table) return [];

  // A table whose first column names a delivery MODE rather than a course —
  // the brochure's shape. The course is in the heading above it, which the
  // caller knows and the table does not, so each row becomes a column of that
  // one subject. Without a subject the rows are prices belonging to an unknown
  // course, and no fact at all beats a fact attached to the wrong thing.
  const namesSubject = /program|course|certification/i.test(table.headers[0] ?? "");
  if (!namesSubject) {
    const subject = (opts.subject ?? "").trim();
    if (!subject) return [];
    const prices: Record<string, number> = {};
    for (const row of table.rows) {
      const n = parseMoney(row[1] ?? "");
      if (n !== null) prices[slug(row[0])] = n;
    }
    return Object.keys(prices).length ? [{ subject, prices }] : [];
  }

  const out: SubjectPrices[] = [];
  for (const row of table.rows) {
    const prices: Record<string, number> = {};
    for (let c = 1; c < row.length; c++) {
      const n = parseMoney(row[c]);
      // Absent, not zero: a zero reads as "free" to everything downstream.
      if (n !== null) prices[slug(table.headers[c] ?? `col-${c}`)] = n;
    }
    if (Object.keys(prices).length) out.push({ subject: row[0], prices });
  }
  return out;
}

/**
 * The typed facts a concept should carry in its front matter.
 *
 * Deliberately a small, fixed set. Every field here is something a lead acts
 * on and a reviewer can check at a glance; anything vaguer would be a second
 * copy of the body with none of its nuance.
 */
export function factsFor(body: string, opts: { subject?: string } = {}): Record<string, string> {
  const text = String(body ?? "");
  const facts: Record<string, string> = {};

  // The subject is the concept's own title, which is where the course name
  // lives for a table that only names delivery modes.
  const priced = parseTables(text).flatMap(t => tableFacts(t, opts));
  const all = priced.flatMap(p => Object.values(p.prices));

  // A price stated in a sentence counts too — not every fee lives in a table.
  for (const m of text.matchAll(/(?:₹|rs\.?|inr)\s*([\d,]{4,})/gi)) {
    const n = parseMoney(m[0]);
    if (n !== null) all.push(n);
  }

  if (all.length) {
    facts.price_min_inr = String(Math.min(...all));
    facts.price_max_inr = String(Math.max(...all));
    const subjects = priced.map(p => p.subject).filter(Boolean);
    if (subjects.length) facts.priced_subjects = subjects.join("; ");
  }

  const months = text.match(/(\d{1,2})\s*months?\b/i);
  if (months) facts.duration_months = months[1];

  // Only a percentage that says what it measures. "20% discount" is not a
  // placement rate, and recording it as one would be worse than recording
  // nothing.
  const placement = text.match(/(\d{1,3})\s*%\s*\+?\s*(?:placement|placed)/i)
    ?? text.match(/placement[^.\n]{0,24}?(\d{1,3})\s*%/i);
  if (placement) facts.placement_pct = placement[1];

  const refund = text.match(/(\d{1,3})\s*%\s*(?:fee\s*)?refund/i);
  if (refund) facts.refund_pct = refund[1];

  return facts;
}
