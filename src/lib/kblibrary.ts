import { parseTables, tableFacts } from "./okffacts";
// The OKF library: the rules deciding where an uploaded concept is filed and
// whether it may go live.
//
// ── Areas are inferred, not declared ─────────────────────────────────────────
//
// Which subject areas a workspace has is decided by reading its own content —
// see kbareas.ts. This file holds only AREA_HINTS: coarse, industry-neutral
// keyword hints used as an OFFLINE FALLBACK when no AI key is configured. They
// never limit which areas can exist; a workspace's library is whatever its
// content turned out to be about.
//
// Why files are still filed into shelves at all: documents are uploaded by
// different people at different times and most restate the same knowledge —
// prices, requirements and locations appear in nearly all of them. Decomposing
// each upload on its own reproduces that mess one level down (areas named after
// their source files, one holding most of the concepts). Filing by SUBJECT is
// what lets two documents that disagree about the same fact meet.

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

/** Offline fallback hints only — see the header. Never the list of areas a workspace may have. */
export const AREA_HINTS: KbArea[] = [
  {
    slug: "products",
    title: "Products & services",
    description: "What you offer, one concept per product, service or plan: what it is, what is included, options and variants, specifications and who it is for.",
    types: ["product"],
    examples: ["Core product", "Add-on service", "Premium plan"],
    keywords: ["product", "products", "service", "services", "plan", "package", "feature", "features", "included", "includes", "specification", "specifications", "variant", "option", "options", "catalogue", "catalog", "menu", "range", "model", "details"],
  },
  {
    slug: "pricing",
    title: "Pricing & payment",
    description: "What things cost and how they can be paid: prices, instalments, EMI, discounts, deposits and the refund policy. Keep the figure and its conditions together.",
    types: ["policy", "pricing"],
    examples: ["Plans & pricing", "Refund policy", "Payment options"],
    keywords: ["fee", "fees", "cost", "price", "pricing", "emi", "instalment", "installment", "payment", "deposit", "discount", "refund", "inr", "rupees", "₹", "invoice", "gst", "tax"],
  },
  {
    slug: "locations",
    title: "Locations & hours",
    description: "Where you are and when: addresses, branches or outlets, service areas, opening hours, directions and visiting arrangements. One concept per location.",
    types: ["location"],
    examples: ["Main branch", "Service area", "Opening hours"],
    keywords: ["location", "locations", "address", "branch", "outlet", "store", "office", "campus", "directions", "map", "landmark", "nearby", "opening hours", "open", "closed", "visit", "walk in", "parking", "metro"],
  },
  {
    slug: "booking",
    title: "Booking & getting started",
    description: "How to get started: eligibility and requirements, the booking or ordering process, documents needed, availability, slots, schedules and lead times.",
    types: ["policy", "faq"],
    examples: ["Eligibility & requirements", "Availability & slots", "How to book"],
    keywords: ["eligibility", "eligible", "requirement", "requirements", "book", "booking", "reserve", "reservation", "appointment", "order", "apply", "application", "sign up", "register", "onboarding", "prerequisite", "documents required", "slot", "availability", "schedule", "timing", "start date", "lead time", "delivery"],
  },
  {
    slug: "outcomes",
    title: "Results & outcomes",
    description: "What customers can expect and the proof behind it: results, success stories, testimonials, guarantees, ratings and case studies.",
    types: ["policy", "faq"],
    examples: ["Customer results", "Guarantees", "Success stories"],
    keywords: ["result", "results", "outcome", "outcomes", "success", "testimonial", "review", "reviews", "rating", "case study", "guarantee", "guaranteed", "proof", "satisfaction", "track record"],
  },
  {
    slug: "company",
    title: "About the business",
    description: "Who you are: history, accreditations and certifications, team, awards, and the claims made about the organisation itself.",
    types: ["company"],
    examples: ["About us", "Certifications", "Team"],
    keywords: ["about us", "founded", "since", "accreditation", "accredited", "certified", "certification", "affiliat", "team", "founder", "award", "recognition", "customers served", "years of experience"],
  },
  {
    slug: "events",
    title: "Offers & events",
    description: "Time-limited things: promotions, seasonal offers, webinars, demos, workshops and open days — what they cover, when they run and how to take part.",
    types: ["event"],
    examples: ["Current offers", "Upcoming events", "How to register"],
    keywords: ["offer", "offers", "promotion", "promotions", "event", "events", "webinar", "workshop", "demo", "free session", "open day", "launch", "limited time", "live session"],
  },
  {
    slug: "support",
    title: "Customer support",
    description: "Help after the sale: how problems are resolved, who to contact, support hours, escalation routes, response times and returns or repairs.",
    types: ["policy", "faq"],
    examples: ["How to get help", "Support hours", "Escalation process"],
    keywords: ["support", "help", "helpdesk", "contact", "assistance", "escalation", "escalate", "grievance", "complaint", "ticket", "response time", "warranty", "repair", "replacement", "return"],
  },
  {
    slug: "faq",
    title: "Frequently asked questions",
    description: "Direct answers to questions customers actually ask, where the answer does not belong to one of the areas above. One concept per question, titled as the question.",
    types: ["faq"],
    examples: ["Is this available online?", "Can I change my booking?"],
    keywords: ["faq", "question", "frequently asked", "what is", "how do i", "can i", "do you"],
  },
  {
    slug: "policies",
    title: "Policies & terms",
    description: "The rules of engagement: terms and conditions, privacy, cancellation, rescheduling and code of conduct. Not prices — those live under Pricing & payment.",
    types: ["policy"],
    examples: ["Terms & conditions", "Privacy policy", "Cancellation policy"],
    keywords: ["policy", "terms", "conditions", "privacy", "cancellation", "cancel", "reschedule", "postpone", "code of conduct", "agreement", "liability"],
  },
];

const BY_SLUG = new Map(AREA_HINTS.map(a => [a.slug, a]));

/** The concept types a fallback hint implies, or null for any area it does not know. */
export function hintTypes(slug: string): string[] | null {
  return BY_SLUG.get(String(slug ?? "").trim().toLowerCase())?.types ?? null;
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
  const scores = AREA_HINTS.map(a => {
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
  // INR belongs here. Fee tables commonly write
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
 * The default order: the website is public and maintained, so it is the most
 * current statement of anything; a brochure is a snapshot that goes stale
 * between printings; templates and master knowledge bases are older still.
 *
 * Patterns match the document's title OR one of its tags, because the same
 * source arrives under both spellings — "KNOWLEDGE_BASE_MASTER.pdf" tagged
 * "Website" is website material, and "Acme FAQ (website)" says so only
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
 * Path equality alone rarely matches, because a path comes from a heading and
 * two documents rarely choose the same one. "Fees" and "Plan Investment" are one
 * subject and never met, so the
 * restatement problem went undetected and the conflict check had almost
 * nothing to check.
 *
 * Three rules, cheapest first, all deterministic and offline:
 *
 *   1. the same path, which is still the common case
 *   2. the same priced item in the same column — two tables quoting the
 *      Standard Plan's monthly price are about the same thing however their
 *      headings are worded
 *   3. a near-identical title within one area
 *
 * Area-scoped throughout. "Main branch" under products and under locations are
 * different subjects, and matching them would merge a product description into
 * an address.
 */
/**
 * Near-identity, not similarity.
 *
 * At 0.6 this matched "Standard Plan Plus" to "Standard Plan Pro" — two different products —
 * because they share "standard" and "plan". Merging those
 * would have put one product's price and details under the other's name, which
 * is worse than never matching at all.
 */
const TITLE_MATCH = 0.85;

/**
 * Words carrying no distinguishing signal in this domain.
 *
 * Product titles tend to share them, so leaving them in means comparing
 * boilerplate and calling it agreement.
 */
const EMPTY_WORDS = new Set([
  "the", "our", "and", "for", "with", "what", "how", "all", "you", "your",
  "plan", "plans", "package", "product", "products", "service", "services",
  "standard", "part",
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

/** Priced item + column, as a comparable key. */
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
