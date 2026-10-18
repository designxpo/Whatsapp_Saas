import { parseTables, tableFacts } from "./okffacts";
// The OKF library: the fixed spine of subject areas, and the rules deciding
// where an uploaded concept is filed and whether it may go live.
//
// ── Why a fixed spine ────────────────────────────────────────────────────────
//
// Ten documents were uploaded by different people at different times and nine
// of them restate the same body of knowledge: fees appear in 9, eligibility in
// 9, the centres in 8. Decomposing each upload on its own reproduces that mess
// one level down — the first dry run produced nine areas named after their
// source files, one holding 1,338 of 1,515 concepts.
//
// So uploads may NOT invent areas. The library's shape is declared here, once,
// and an upload is filed INTO it. That single rule is what stops the structure
// depending on who happened to upload what.
//
// Each area's `description` does double duty: it is the guidance an uploader
// reads in the portal, and the signal the classifier files against. Keeping
// them the same text is deliberate — if the help says one thing and the
// classifier believes another, uploaders are being misled.

export type ConceptStatus = "active" | "pending" | "superseded";

export interface KbArea {
  /** Directory name, and the first segment of every concept path in it. */
  slug: string;
  title: string;
  /** What belongs here. Shown to uploaders; used to classify. */
  description: string;
  /** Concept types that make sense in this area. */
  types: string[];
  /** Concrete concept names, so "what goes here" is never abstract. */
  examples: string[];
  /** Words that indicate this area. Weighted: a word may appear in several. */
  keywords: string[];
}

export const KB_AREAS: KbArea[] = [
  {
    slug: "courses",
    title: "Courses & curriculum",
    description: "What each programme teaches: syllabus, modules, tools covered, duration, format (online, classroom, hybrid) and who it is for. One concept per programme.",
    types: ["course"],
    examples: ["Data Analytics", "Data Science & AI", "Full Stack AI", "GenAI"],
    keywords: ["course", "programme", "program", "curriculum", "syllabus", "module", "certification", "training", "learn", "topics", "tools", "python", "sql", "power bi", "tableau", "machine learning"],
  },
  {
    slug: "fees",
    title: "Fees & payment",
    description: "What a programme costs and how it can be paid: fees, instalments, EMI, scholarships, discounts and the refund policy. Keep the figure and its conditions together.",
    types: ["policy", "fees"],
    examples: ["Tuition & EMI", "Refund policy", "Scholarships"],
    keywords: ["fee", "fees", "cost", "price", "pricing", "emi", "instalment", "installment", "payment", "scholarship", "discount", "refund", "inr", "rupees", "₹"],
  },
  {
    slug: "centres",
    title: "Centres & locations",
    description: "The physical centres and how to reach them: addresses, cities served, classroom availability and visiting arrangements. One concept per centre.",
    types: ["centre"],
    examples: ["Noida centre", "Gurgaon centre", "Bangalore centre", "Online delivery"],
    keywords: ["centre", "center", "campus", "classroom", "address", "location", "noida", "gurgaon", "gurugram", "bangalore", "bengaluru", "delhi", "ncr", "visit", "walk in", "metro", "directory", "directories", "branch", "office address", "sector"],
  },
  {
    slug: "admissions",
    title: "Admissions & batches",
    description: "Getting in and getting started: eligibility, prerequisites, the application process, batch dates, schedules and class timings.",
    types: ["policy", "faq"],
    examples: ["Eligibility criteria", "Batch dates", "How to apply"],
    keywords: ["eligibility", "eligible", "admission", "admissions", "admission process", "apply", "application", "enrol", "enroll", "enrollment", "enrolment", "prerequisite", "required document", "documents required", "joining", "batch", "schedule", "timing", "weekend", "weekday", "start date", "intake", "qualification", "graduate"],
  },
  {
    slug: "placements",
    title: "Placements & careers",
    description: "Career outcomes and the support behind them: placement rates, salary ranges, job roles graduates move into, hiring partners and interview preparation.",
    types: ["policy", "faq"],
    examples: ["Placement outcomes", "Placement support", "Roles & salaries"],
    keywords: ["placement", "placed", "job", "career", "hiring", "recruiter", "salary", "ctc", "lpa", "package", "interview", "resume", "company", "role", "hike"],
  },
  {
    slug: "company",
    title: "About the business",
    description: "Who we are: history, accreditations and affiliations, faculty and trainers, awards, and the claims made about the organisation itself.",
    types: ["company"],
    examples: ["About us", "Accreditations", "Faculty"],
    keywords: ["analytixlabs", "about us", "founded", "since", "accreditation", "accredited", "affiliat", "faculty", "trainer", "mentor", "award", "recognition", "alumni", "learners trained"],
  },
  {
    slug: "masterclass",
    title: "Masterclasses & events",
    description: "Free sessions, webinars, demo classes and workshops: what they cover, when they run and how to register.",
    types: ["event"],
    examples: ["Masterclass schedule", "How to register"],
    keywords: ["masterclass", "master class", "webinar", "workshop", "demo class", "free session", "register", "registration", "live session"],
  },
  {
    slug: "support",
    title: "Student support",
    description: "Help while studying: how doubts are resolved, mentor and trainer access, office hours, escalation routes, and who to contact when something goes wrong.",
    types: ["policy", "faq"],
    examples: ["Doubt resolution", "Office hours", "Escalation process"],
    keywords: ["support", "doubt", "query resolution", "mentor", "office hours", "escalation", "escalate", "helpdesk", "contact", "assistance", "grievance", "complaint", "ticket", "response time"],
  },
  {
    slug: "faq",
    title: "Frequently asked questions",
    description: "Direct answers to questions leads actually ask, where the answer does not belong to one of the areas above. One concept per question, titled as the question.",
    types: ["faq"],
    examples: ["Is the certificate recognised?", "Can I switch batches?"],
    keywords: ["faq", "question", "frequently asked", "what is", "how do i", "can i", "do you"],
  },
  {
    slug: "policies",
    title: "Policies & terms",
    description: "The rules of engagement: terms and conditions, privacy, cancellation, deferral and code of conduct. Not fees — those live under Fees & payment.",
    types: ["policy"],
    examples: ["Terms & conditions", "Privacy policy", "Deferral policy"],
    keywords: ["policy", "terms", "conditions", "privacy", "cancellation", "deferral", "postpone", "code of conduct", "agreement", "liability"],
  },
];

const BY_SLUG = new Map(KB_AREAS.map(a => [a.slug, a]));

/** An area by slug. Case is not a new area; an unknown slug is not an area. */
export function areaBySlug(slug: string): KbArea | null {
  return BY_SLUG.get(String(slug ?? "").trim().toLowerCase()) ?? null;
}

/** The areas, for a portal picker, in declaration order. */
export function areaChoices(): { slug: string; title: string; description: string; examples: string[] }[] {
  return KB_AREAS.map(({ slug, title, description, examples }) => ({ slug, title, description, examples }));
}

// ── Filing ───────────────────────────────────────────────────────────────────

/**
 * A keyword, matched as a word rather than as a run of letters.
 *
 * Plain substring matching filed "We serve free coffee" under Fees because
 * "fee" sits inside "coffee", and "Our academic standards are high" under Fees
 * because "emi" sits inside "academic" — both with full confidence, which is
 * the worst combination: wrong and certain.
 *
 * Short words are matched exactly. Four characters and over may carry a
 * suffix, so "eligib" still catches "eligibility" and "accredit" catches
 * "accreditation" without needing every inflection listed.
 */
const RE_CACHE = new Map<string, RegExp>();
function keywordRe(kw: string): RegExp {
  const hit = RE_CACHE.get(kw);
  if (hit) return hit;
  const esc = kw.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\b${esc}${kw.length >= 4 ? "[a-z]*" : ""}\\b`, "g");
  RE_CACHE.set(kw, re);
  return re;
}

/**
 * Which area a piece of text belongs to, by keyword evidence.
 *
 * Deterministic and offline — no model call, so it runs identically in a test,
 * in a migration script and in the request path. In production this is the
 * first pass; a concept it cannot place is reviewed, and embedding centroids
 * can be layered on later for the ones keywords miss.
 *
 * It returns NULL rather than a best guess when the evidence is absent or
 * split. A misfiled concept is worse than an unfiled one: it is findable only
 * by accident, and nobody knows it is in the wrong place.
 */
export function classifyByKeywords(text: string): { area: string | null; confidence: number } {
  const hay = ` ${String(text ?? "").toLowerCase().replace(/\s+/g, " ")} `;
  const scores = KB_AREAS.map(a => {
    let score = 0;
    for (const kw of a.keywords) {
      // Count occurrences, so a passage about fees beats one that mentions a
      // fee in passing — but damp it, or one repeated word wins outright.
      const hits = (hay.match(keywordRe(kw)) ?? []).length;
      if (hits) score += 1 + Math.log2(hits);
    }
    return { slug: a.slug, score };
  }).sort((x, y) => y.score - x.score);

  const [best, second] = scores;
  if (!best || best.score === 0) return { area: null, confidence: 0 };
  // A tie is not a coin toss worth taking silently.
  if (second && second.score === best.score) return { area: null, confidence: 0 };
  const margin = (best.score - (second?.score ?? 0)) / best.score;
  return { area: best.slug, confidence: Number(margin.toFixed(3)) };
}

// ── Facts ────────────────────────────────────────────────────────────────────

export interface Facts {
  /** Money in rupees, normalised: "₹6 lakh" and "600000" are the same fact. */
  money: string[];
  percents: string[];
  months: string[];
}

const uniqSorted = (xs: string[]): string[] => [...new Set(xs)].sort();

/**
 * The figures a lead would act on, pulled out of prose.
 *
 * Only numbers are compared, never wording. Two documents describing the same
 * fee in different sentences must not read as a disagreement, or the review
 * queue fills with prose edits and nobody reads it.
 */
export function comparableFacts(text: string): Facts {
  const t = String(text ?? "");
  const money: string[] = [];
  // "₹6 lakh" / "6 LPA" — scale words first, so the plain-number pass below
  // does not record a bare "6".
  const scaled = new Set<string>();
  for (const m of t.matchAll(/(?:₹|rs\.?|inr)?\s*(\d{1,3}(?:\.\d+)?)\s*(lakh|lac|lpa)\b/gi)) {
    money.push(String(Math.round(parseFloat(m[1]) * 100000)));
    scaled.add(m[0]);
  }
  let rest = t;
  for (const s of scaled) rest = rest.split(s).join(" ");
  // INR belongs here. Every fee table in this knowledge base writes
  // "INR 41,300/-", and a parser that only knew the rupee sign and "Rs."
  // found no money in any of them — so two tables quoting different fees
  // compared as equal and a genuine contradiction merged silently. The same
  // oversight cannot recur in okffacts.parseMoney, which has always read all
  // three; the duplication is the hazard, and these two must agree.
  for (const m of rest.matchAll(/(?:₹|rs\.?|inr)\s*([\d,]{3,})/gi)) {
    money.push(m[1].replace(/,/g, ""));
  }
  const percents = [...t.matchAll(/(\d{1,3})\s*%/g)].map(m => m[1]);
  const months = [...t.matchAll(/(\d{1,2})\s*months?\b/gi)].map(m => m[1]);
  return { money: uniqSorted(money), percents: uniqSorted(percents), months: uniqSorted(months) };
}

/**
 * Do two statements of the same subject contradict each other?
 *
 * Disagreement means both sides state a value for the same KIND of fact and
 * the values differ. One side saying less is not a contradiction — a short
 * summary that omits the duration has not denied it — and treating silence as
 * conflict is the fastest way to make the queue useless.
 */
export function factsDisagree(a: string, b: string): boolean {
  const fa = comparableFacts(a), fb = comparableFacts(b);
  for (const k of ["money", "percents", "months"] as const) {
    if (!fa[k].length || !fb[k].length) continue;        // silence is not denial
    if (fa[k].join(",") !== fb[k].join(",")) return true;
  }
  return false;
}

// ── Source precedence ────────────────────────────────────────────────────────

/**
 * Which source to believe when two disagree, most trusted first.
 *
 * Set by Priyesh on 6 Oct 2026: the website is public and maintained, so it is
 * the most current statement of anything; the brochure is a snapshot that goes
 * stale between printings; the mail templates and the master knowledge base
 * are older still.
 *
 * Patterns match the document's title OR one of its tags, because the same
 * source arrives under both spellings — "KNOWLEDGE_BASE_MASTER.pdf" tagged
 * "Website" is website material, and "AnalytixLabs FAQ (website)" says so only
 * in its title.
 */
export const KB_SOURCE_PRIORITY: { label: string; match: RegExp }[] = [
  { label: "website", match: /website|\bweb\b/i },
  { label: "brochure", match: /brochure/i },
];

/** Lower is more trusted. An unlisted source ranks last, never nowhere. */
export function sourceRank(source: string, tags: string[] = []): number {
  const hay = [source, ...tags].join(" ");
  const i = KB_SOURCE_PRIORITY.findIndex(p => p.match.test(hay));
  return i === -1 ? KB_SOURCE_PRIORITY.length : i;
}

const sourceLabel = (source: string, tags: string[] = []): string =>
  KB_SOURCE_PRIORITY[sourceRank(source, tags)]?.label ?? "other";

// ── Reconciliation ───────────────────────────────────────────────────────────

export interface LibraryConcept {
  path: string;
  type: string;
  title: string;
  body: string;
  tags: string[];
  status: ConceptStatus;
  /** The upload this came from. */
  source: string;
  /** Every upload that has contributed, once merged. */
  sources?: string[];
}

export interface Reconciliation {
  action: "publish" | "merge" | "quarantine" | "supersede-incoming";
  concept: LibraryConcept & { sources: string[] };
  /** Concepts this one replaces. Empty on a conflict — nothing is retired. */
  supersede: string[];
  reason: string;
}

/**
 * The published concept an upload is actually about, or null.
 *
 * Path equality alone matched 8 times across 1,515 real concepts, because a
 * path comes from a heading and two documents rarely choose the same one.
 * "Fees" and "Course Investment" are one subject and never met, so the
 * restatement problem went undetected and the conflict check had almost
 * nothing to check.
 *
 * Three rules, cheapest first, all deterministic and offline:
 *
 *   1. the same path, which is still the common case
 *   2. the same priced programme in the same column — two tables quoting
 *      Analytics Edge's classroom fee are about the same thing however their
 *      headings are worded
 *   3. a near-identical title within one area
 *
 * Area-scoped throughout. "Noida centre" under courses and under centres are
 * different subjects, and matching them would merge a course description into
 * an address.
 */
/**
 * Near-identity, not similarity.
 *
 * At 0.6 this matched "Advanced Certification in Data Analytics & AI" to
 * "Advanced Certification in Data Science & GenAI" — two different courses —
 * because they share "advanced", "certification" and "data". Merging those
 * would have put one course's fees and syllabus under the other's name, which
 * is worse than never matching at all.
 */
const TITLE_MATCH = 0.85;

/**
 * Words carrying no distinguishing signal in this domain.
 *
 * Every programme title here contains most of them, so leaving them in means
 * comparing boilerplate and calling it agreement.
 */
const EMPTY_WORDS = new Set([
  "the", "our", "and", "for", "with", "what", "how", "all", "you", "your",
  "course", "courses", "program", "programme", "programs", "certification",
  "certificate", "advanced", "adv", "cert", "data", "analytixlabs", "part",
]);

const titleTokens = (s: string): Set<string> =>
  new Set(String(s ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/)
    .filter(w => w.length > 2 && !EMPTY_WORDS.has(w)));

/** A mechanical split of a heading-less document, not a subject anyone chose. */
const isSplitPart = (title: string): boolean => /\(part \d+ of \d+\)/i.test(String(title ?? ""));

const overlap = (a: Set<string>, b: Set<string>): number => {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / Math.max(a.size, b.size);
};

/** Priced programme + column, as a comparable key. */
function pricedKeys(body: string, title: string): Set<string> {
  const out = new Set<string>();
  for (const t of parseTables(body)) {
    for (const f of tableFacts(t, { subject: title })) {
      for (const col of Object.keys(f.prices)) {
        out.add(`${f.subject.toLowerCase().replace(/[^a-z0-9]+/g, "-")}|${col}`);
      }
    }
  }
  return out;
}

const areaOf = (path: string): string => path.includes("/") ? path.split("/")[0] : "";

export function relatedConcept(incoming: LibraryConcept, existing: LibraryConcept[]): LibraryConcept | null {
  const live = existing.filter(c => c.status === "active");

  const samePath = live.find(c => c.path === incoming.path);
  if (samePath) return samePath;

  const area = areaOf(incoming.path);
  const inArea = live.filter(c => areaOf(c.path) === area);
  if (!inArea.length) return null;

  const mine = pricedKeys(incoming.body, incoming.title);
  if (mine.size) {
    const priced = inArea.find(c => {
      const theirs = pricedKeys(c.body, c.title);
      for (const k of mine) if (theirs.has(k)) return true;
      return false;
    });
    if (priced) return priced;
  }

  // Mechanical splits are numbered pieces of one document, deliberately
  // distinct, and they share every word of their title. Matching them to each
  // other would fold a whole document back into its first fragment.
  if (isSplitPart(incoming.title)) return null;

  const myTitle = titleTokens(incoming.title);
  if (!myTitle.size) return null;          // nothing distinguishing left to compare
  let best: { c: LibraryConcept; score: number } | null = null;
  for (const c of inArea) {
    if (isSplitPart(c.title)) continue;
    const score = overlap(myTitle, titleTokens(c.title));
    if (score >= TITLE_MATCH && score > (best?.score ?? 0)) best = { c, score };
  }
  return best?.c ?? null;
}

/**
 * What an upload is allowed to do to the knowledge already in the library.
 *
 * The rule that matters:
 *
 *     An upload can never silently change what the bot tells a lead.
 *
 * Today a file dropped into the portal is retrievable minutes later with no
 * review. Here, an upload that contradicts a live answer lands `pending` and
 * the live answer stays live until a person chooses between them. Only
 * `active` concepts are embedded, so retrieval is never choosing between two
 * versions of the truth.
 */
export function reconcile(
  incoming: LibraryConcept,
  existing: LibraryConcept[],
  opts: { area?: string | null } = {},
): Reconciliation {
  const sources = (xs: LibraryConcept[]): string[] =>
    [...new Set(xs.flatMap(c => c.sources ?? (c.source ? [c.source] : [])))];

  // Unplaceable: no area, so there is no shelf to put it on. Reviewed, never
  // dropped into whichever area scored least badly.
  if (opts.area === null || (!incoming.path && opts.area !== undefined)) {
    return {
      action: "quarantine",
      concept: { ...incoming, status: "pending", sources: sources([incoming]) },
      supersede: [],
      reason: "could not be filed to an area — needs a person to place it",
    };
  }

  // Subject, not filename — see relatedConcept.
  const match = relatedConcept(incoming, existing);
  if (!match) {
    return {
      action: "publish",
      concept: { ...incoming, status: "active", sources: sources([incoming]) },
      supersede: [],
      reason: "no existing concept on this subject",
    };
  }

  if (factsDisagree(match.body, incoming.body)) {
    const a = comparableFacts(match.body), b = comparableFacts(incoming.body);
    const diff = (["money", "percents", "months"] as const)
      .filter(k => a[k].length && b[k].length && a[k].join(",") !== b[k].join(","))
      .map(k => `${k}: live [${a[k].join(", ")}] vs upload [${b[k].join(", ")}]`)
      .join("; ");

    // Precedence settles a disagreement between DIFFERENT sources, and only
    // that. Two brochures contradicting each other is a question about the
    // content, which no ranking can answer.
    const liveRank = sourceRank(match.sources?.[0] ?? match.source, match.tags);
    const inRank = sourceRank(incoming.source, incoming.tags);

    if (inRank < liveRank) {
      // A more trusted source genuinely supersedes. This is the one case where
      // an upload changes a live answer without a person, and it does so
      // because somebody decided in advance that it should — the retired
      // concept is kept, so the change is auditable rather than invisible.
      return {
        action: "publish",
        concept: { ...incoming, status: "active", sources: sources([incoming]) },
        supersede: [match.path],
        reason: `${sourceLabel(incoming.source, incoming.tags)} outranks ${sourceLabel(match.sources?.[0] ?? match.source, match.tags)} — ${diff}`,
      };
    }
    if (inRank > liveRank) {
      return {
        action: "supersede-incoming",
        concept: { ...incoming, status: "superseded", sources: sources([incoming]) },
        supersede: [],
        reason: `kept the published answer: ${sourceLabel(incoming.source, incoming.tags)} is lower priority than ${sourceLabel(match.sources?.[0] ?? match.source, match.tags)} — ${diff}`,
      };
    }
    return {
      action: "quarantine",
      concept: { ...incoming, status: "pending", sources: sources([incoming]) },
      supersede: [],                                   // the live answer stays live
      reason: `conflicts with the published concept — ${diff}`,
    };
  }

  // Agrees. One canonical concept, carrying every tag and every source, so no
  // channel loses access and the provenance of a merged fact is still visible.
  return {
    action: "merge",
    concept: {
      ...match,
      body: match.body.length >= incoming.body.length ? match.body : incoming.body,
      tags: [...new Set([...match.tags, ...incoming.tags])],
      status: "active",
      sources: sources([match, incoming]),
    },
    supersede: [],
    reason: "restates the published concept; merged",
  };
}
