// Competitor content-gap analysis — the pure half of the nightly content
// pipeline (scripts/content-pipeline/).
//
// What this does NOT have, and the pipeline is honest about: real search
// volume. That needs a paid keyword API (Semrush, Ahrefs, DataForSEO). What it
// has instead is a defensible proxy — how many independent competitors have
// each written a page on the same topic. Six companies spending money on the
// same article is evidence of demand; it is weaker evidence than a volume
// number, and the PR body says so rather than dressing a guess as data.
//
// Pure and dependency-free so the scoring can be tested without network access,
// which matters: this decides what gets written, and a scorer that quietly
// drifts produces a month of pages nobody searches for.

export interface Page { url: string; title: string }
export interface CompetitorPages { competitor: string; pages: Page[] }
export interface Gap {
  /** Normalised topic key — what makes two competitors' pages "the same topic". */
  topic: string;
  /** The most readable of the competitor titles seen for this topic. */
  label: string;
  /** Which competitors cover it. Length is the demand proxy. */
  covered: string[];
  /** One example url per competitor, for the PR body to cite. */
  examples: string[];
  score: number;
}

// Words that carry no topical meaning in a title, plus the publisher furniture
// that would otherwise make every competitor's blog look like the same topic.
const STOP = new Set([
  "the", "a", "an", "and", "or", "for", "to", "of", "in", "on", "with", "your",
  "you", "how", "what", "why", "is", "are", "do", "does", "can", "guide",
  "complete", "ultimate", "best", "top", "blog", "article", "post", "2024",
  "2025", "2026", "2027", "vs", "versus", "free", "new", "it", "that", "this",
]);

/** Competitor brand names must not become topics — every one of their pages mentions them. */
const BRANDS = new Set([
  "wati", "aisensy", "interakt", "respond", "respondio", "manychat", "tidio",
  "talko", "gallabox", "zoko", "doubletick", "wabi",
]);

/**
 * Reduce a page title to a comparable topic key.
 *
 * Two competitors writing "WhatsApp Business API Pricing in 2026" and "How Much
 * Does the WhatsApp Business API Cost?" are covering one topic, and a naive
 * string compare says they are not. Stemming the obvious plural/gerund endings
 * and dropping stopwords collapses most of that without a stemming library.
 */
export function normalizeTopic(title: string): string {
  const words = (title || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .map(w => w.replace(/(ing|ers|er|ies|s)$/, m => (m === "ies" ? "y" : "")))
    .filter(w => w.length > 2 && !STOP.has(w) && !BRANDS.has(w));
  // Sorted + deduped so word order never splits one topic into two.
  return [...new Set(words)].sort().join(" ");
}

/**
 * How much two topic keys overlap, 0..1 — the overlap coefficient
 * (shared / smaller set), deliberately not Jaccard.
 *
 * Jaccard divides by the union, so it punishes a title merely for being
 * longer. "WhatsApp Green Tick" and "WhatsApp Green Tick Verification
 * Explained" are plainly one topic and score only 0.6 under Jaccard — enough
 * to split them, which in turn means two competitors covering one topic never
 * reach the consensus floor and the gap is never reported. Real titles vary in
 * length far more than they vary in subject, so the smaller set is the right
 * denominator.
 */
export function topicSimilarity(a: string, b: string): number {
  const A = new Set(a.split(" ").filter(Boolean));
  const B = new Set(b.split(" ").filter(Boolean));
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  return shared / Math.min(A.size, B.size);
}

/**
 * Non-English titles must not become topics.
 *
 * A dry run's top-ranked gap was "体验新的Wati：您的升级版WhatsApp API服务" — the
 * normaliser strips non-ASCII, so a Chinese page reduced to "api whatsapp",
 * clustered happily with English pages, and won. A competitor's translated
 * pages are the same article again in a language this blog does not publish.
 */
export function isEnglishish(title: string): boolean {
  const letters = (title.match(/\p{L}/gu) ?? []).length;
  if (!letters) return false;
  const latin = (title.match(/[A-Za-z]/g) ?? []).length;
  return latin / letters >= 0.7;
}

/**
 * Topic keys this similar are treated as the same topic — both for clustering
 * competitors together and for deciding we have already covered something.
 */
const SAME_TOPIC_AT = 0.6;
/**
 * …and must also share this much of their COMBINED vocabulary.
 *
 * The overlap coefficient alone scores a two-word topic that is a subset of a
 * seven-word one at a perfect 1.0, so narrow topics were being swallowed by
 * broad ones and 359 crawled pages collapsed into five clusters. Requiring a
 * Jaccard floor as well keeps "WhatsApp Green Tick" merging with "How to Get
 * the WhatsApp Green Tick" (0.5) while keeping it apart from a sprawling
 * seven-word title that merely contains both words (0.29).
 */
const MIN_SHARED_VOCAB = 0.35;

/**
 * Strip the publisher furniture competitors append to every <title>.
 * "How to verify Facebook Business Manager Account? | AiSensy" is the topic
 * plus their brand, and the brand half travels into the PR and the writer's
 * prompt if it is not removed here.
 */
export function cleanTitle(title: string): string {
  return (title || "")
    .replace(/\s*[|\u2013\u2014-]\s*[^|\u2013\u2014-]{1,40}$/, (m) =>
      /\b(wati|aisensy|interakt|respond|manychat|tidio|blog|com)\b/i.test(m) ? "" : m)
    .trim();
}

/** Both tests must pass for two titles to count as one topic. */
function sameTopic(a: string, b: string): boolean {
  if (topicSimilarity(a, b) < SAME_TOPIC_AT) return false;
  const A = new Set(a.split(" ").filter(Boolean));
  const B = new Set(b.split(" ").filter(Boolean));
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  return shared / (A.size + B.size - shared) >= MIN_SHARED_VOCAB;
}

/**
 * Topics competitors write about that we have no page for.
 *
 * Titles are CLUSTERED rather than grouped by exact key. An earlier version
 * keyed on the normalised string, which looks equivalent and is not: two
 * competitors writing "WhatsApp Green Tick Verification Explained" and "How to
 * Get the WhatsApp Green Tick" produced two keys, each with one competitor, so
 * a topic both of them cared about fell below the floor and vanished. Exact
 * keys only ever find topics that happen to be titled alike.
 *
 * `minCompetitors` is the demand floor. One competitor writing about something
 * is that company's guess about their audience. Two independent companies is
 * the cheapest honest signal that a topic is worth the cost of a page.
 */
export function findGaps(
  competitors: CompetitorPages[],
  ourPages: Page[],
  opts: { minCompetitors?: number; relevanceTerms?: string[] } = {},
): Gap[] {
  const minCompetitors = opts.minCompetitors ?? 2;
  const ours = ourPages.map(p => normalizeTopic(p.title)).filter(Boolean);

  interface Cluster { key: string; covered: Set<string>; titles: string[]; examples: string[] }
  const clusters: Cluster[] = [];

  for (const { competitor, pages } of competitors) {
    // A competitor publishing three near-identical posts must still count once
    // for that topic, or one prolific blog alone looks like consensus.
    const countedHere = new Set<Cluster>();
    for (const page of pages) {
      const topic = normalizeTopic(page.title);
      if (!isEnglishish(page.title)) continue;
      if (!topic || topic.split(" ").length < 2) continue;   // too thin to be a topic
      let cluster = clusters.find(c => sameTopic(c.key, topic));
      if (!cluster) {
        cluster = { key: topic, covered: new Set<string>(), titles: [], examples: [] };
        clusters.push(cluster);
      }
      if (!countedHere.has(cluster)) { cluster.covered.add(competitor); countedHere.add(cluster); }
      cluster.titles.push(page.title);
      if (cluster.examples.length < 4) cluster.examples.push(page.url);
    }
  }

  return clusters
    .filter(c => c.covered.size >= minCompetitors)
    .filter(c => !ours.some(o => sameTopic(o, c.key)))
    .map(c => ({
      topic: c.key,
      // Shortest title is usually the least keyword-stuffed phrasing of it.
      label: cleanTitle([...c.titles].sort((a, b) => a.length - b.length)[0]),
      covered: [...c.covered].sort(),
      examples: c.examples,
      score: scoreGap(c.key, c.covered.size, opts.relevanceTerms ?? []),
    }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Rank a gap. Competitor consensus dominates; product relevance breaks ties.
 *
 * Relevance matters because consensus alone will happily surface a topic our
 * product has nothing to say about — competitors write about plenty we do not
 * do, and a page written from no real expertise is exactly the thin content
 * Google's scaled-content policy targets.
 */
export function scoreGap(topic: string, competitorCount: number, relevanceTerms: string[]): number {
  // Diminishing: the jump from 2 to 3 competitors means far more than 5 to 6.
  const consensus = Math.log2(competitorCount + 1) * 10;
  const words = new Set(topic.split(" "));
  const relevance = relevanceTerms.filter(t => words.has(t)).length * 3;
  // Very broad two-word topics ("whatsapp marketing") are contested by everyone
  // and unwinnable for a young domain; very long ones are usually one
  // competitor's odd phrasing rather than a real query.
  const specificity = words.size >= 3 && words.size <= 7 ? 4 : 0;
  return Number((consensus + relevance + specificity).toFixed(2));
}
