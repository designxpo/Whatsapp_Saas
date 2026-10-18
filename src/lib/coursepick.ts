// Asking the lead which programme they are on, because nothing else knows.
//
// ── Why this exists ────────────────────────────────────────────────────────
//
// Three of the five drip steps are addressed by the lead's course. Measured
// 14 Oct, across the 1,000 most recent leads on "Not Reachable":
//
//   has a first name              855   day 3 and day 28 can send
//   has ANY course value          283
//   a course we can use             0   day 7, 12 and 18 need this
//
// 254 of them hold the literal string "66" — a form posting an option id
// instead of its label. The course is not in mx_Course_Suggested,
// mx_program_interested or mx_Looking_for either; all three are empty or
// junk. The tracked link rescues the paid traffic (courseFromLabel), but
// only 37 of 3,190 contacts have one.
//
// So for everybody else the only remaining source of truth is the person.
//
// ── Why a list and not buttons ─────────────────────────────────────────────
//
// WhatsApp allows three interactive buttons and ten list rows. Three would
// mean dropping real programmes and guessing which three matter, which is
// how a lead ends up telling us the nearest wrong answer. The list fits
// every programme that unlocks something.
//
// ── Why no template is needed ──────────────────────────────────────────────
//
// This is only ever sent in reply to a lead who just wrote to us, so the
// 24-hour service window is open and free-form interactive messages are
// allowed. Nothing here needs Meta's approval, which is what makes it
// deployable now rather than after a review.
//
// ── Why the rows are generated, not typed ──────────────────────────────────
//
// The row title is the routing key: a list reply arrives as its TITLE, not
// its id (wa-message.ts). Typing the labels here and the programmes there
// would let the two drift, and a drifted label is a lead whose answer
// matches nothing and is silently discarded. So both come from PROGRAMMES.

import { PROGRAMMES, programmeFor, normCourse, type Programme } from "./leadtokens";

/** WhatsApp truncates a list row title at 24 characters. */
export const ROW_TITLE_MAX = 24;

/** WhatsApp allows ten rows across all sections. */
export const MAX_ROWS = 10;

export interface CoursePick {
  /** What the lead sees, and therefore what comes back. */
  title: string;
  /** The CRM spelling to store, so the audience rules match it. */
  crmName: string;
}

/**
 * A programme is worth offering only if naming it unlocks a message.
 *
 * AI for Managers has neither a role pair nor a CTC, so a lead picking it
 * would answer the question and still receive nothing — which teaches them
 * the question was pointless.
 */
const unlocksSomething = (p: Programme): boolean => !!p.roles || !!p.minCtc;

/** A title the lead will recognise, inside WhatsApp's limit. */
function rowTitle(p: Programme): string {
  if (p.display.length <= ROW_TITLE_MAX) return p.display;
  // Drop the qualifier rather than hard-cutting mid-word: "Executive Data
  // Science & AI" becomes "Executive Data Science", which is still the thing
  // they signed up for.
  const cut = p.display.slice(0, ROW_TITLE_MAX);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 10 ? cut.slice(0, lastSpace) : cut).replace(/[\s&·-]+$/, "");
}

/**
 * The options, generated from the programme table.
 *
 * Deduplicated on the title, because two programmes whose names collide once
 * truncated would be indistinguishable in the reply — and the first of them
 * would silently win every time.
 */
export function coursePicks(): CoursePick[] {
  const out: CoursePick[] = [];
  const seen = new Set<string>();
  for (const p of PROGRAMMES) {
    if (!unlocksSomething(p)) continue;
    // Older catalogue names are recognised when a lead or the CRM uses one,
    // but never OFFERED: the list holds ten rows and takes the first ten
    // programmes, so showing the legacy names would push today's catalogue
    // off the end of the question we ask a lead.
    if (p.legacy) continue;
    const title = rowTitle(p);
    const key = normCourse(title);
    if (!title || seen.has(key)) continue;
    seen.add(key);
    out.push({ title, crmName: p.crmNames[0] });
    if (out.length >= MAX_ROWS) break;
  }
  return out;
}

/** The question itself. Short: it is interrupting a conversation. */
export const COURSE_PROMPT = "Which programme are you interested in? It helps us send you the right details.";
export const COURSE_BUTTON = "Choose a programme";

/**
 * Match a reply against the options.
 *
 * Matched on the TITLE, because that is what a list reply carries — Meta
 * sends the row's title, not its id (wa-message.ts). Normalised, so casing
 * and punctuation cannot cost us the answer.
 */
export function matchCoursePick(text: string): string | null {
  const t = normCourse(text);
  if (!t) return null;
  for (const p of coursePicks()) {
    if (normCourse(p.title) === t) return p.crmName;
  }
  // A lead who TYPED the course rather than tapping still deserves an answer.
  const direct = programmeFor(text);
  if (direct && unlocksSomething(direct)) return direct.crmNames[0];
  return null;
}

/**
 * Is this lead worth asking?
 *
 * Only when we genuinely cannot answer it ourselves. Asking somebody a
 * question we already know the answer to is how a helpful prompt becomes an
 * irritation — and the value already on the contact may be one the lead gave
 * us themselves.
 */
export function needsCourse(attributes: Record<string, string> | null | undefined): boolean {
  const held = String((attributes ?? {})["Product Name"] ?? "").trim();
  if (!held) return true;
  // Present but unusable — "66", "Select", "-" — is the same as absent for
  // every purpose downstream, and is the commonest case in the live data.
  return !programmeFor(held);
}
