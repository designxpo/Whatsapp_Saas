// Stage 4 — the editor.
//
// Deterministic checks first, and they are the ones that matter. An LLM asked
// "is this good?" says yes to almost anything; an LLM asked "does this post
// have sources, FAQs, and three internal links" is doing a job a regex does
// more reliably and for free. The model is reserved for the one check code
// cannot make — whether a specific factual claim is supported.

export interface Draft {
  slug: string; title: string; excerpt: string; category: string; readTime: string;
  body: { type: string; text?: string; items?: string[] }[];
  faqs?: { q: string; a: string }[];
  sources?: { label: string; href: string; note?: string }[];
}
export interface Issue { rule: string; detail: string }

const WORDS = (d: Draft) =>
  d.body.flatMap(b => [b.text ?? "", ...(b.items ?? [])]).join(" ").split(/\s+/).filter(Boolean).length;

/**
 * Phrases that mark copy as machine-written filler. Not a style preference —
 * these are the tells that make a page read as one of a thousand identical
 * posts, which is the thing Google's scaled-content policy is pointed at.
 */
const FILLER = [
  "in today's fast-paced", "in the ever-evolving", "it's no secret that",
  "look no further", "game-changer", "revolutionize", "unlock the power",
  "dive deep", "in conclusion", "the digital landscape", "harness the power",
  "take your business to the next level", "seamlessly integrate",
];

export function checkDraft(draft: Draft, existingSlugs: string[]): Issue[] {
  const issues: Issue[] = [];
  const text = draft.body.flatMap(b => [b.text ?? "", ...(b.items ?? [])]).join(" ");
  const words = WORDS(draft);

  if (existingSlugs.includes(draft.slug)) issues.push({ rule: "slug", detail: `"${draft.slug}" already exists.` });
  if (!/^[a-z0-9-]+$/.test(draft.slug)) issues.push({ rule: "slug", detail: "Slug must be lowercase letters, digits and hyphens." });

  if (words < 900) issues.push({ rule: "depth", detail: `${words} words. A page thin enough to be written by anyone ranks for nobody — aim past 900.` });
  if (draft.title.length > 70) issues.push({ rule: "title", detail: `${draft.title.length} chars; keep under 70 so it is not truncated in results.` });
  if (draft.excerpt.length < 80 || draft.excerpt.length > 300) {
    issues.push({ rule: "excerpt", detail: `${draft.excerpt.length} chars; the meta description wants 80–300.` });
  }

  const h2s = draft.body.filter(b => b.type === "h2").length;
  if (h2s < 3) issues.push({ rule: "structure", detail: `${h2s} H2 sections; a reader needs at least 3 to scan it.` });
  if ((draft.faqs?.length ?? 0) < 4) issues.push({ rule: "faqs", detail: `${draft.faqs?.length ?? 0} FAQs; 4+ earns the FAQPage schema its place.` });
  if ((draft.sources?.length ?? 0) < 2) issues.push({ rule: "sources", detail: "Fewer than 2 primary sources. Every factual claim needs somewhere it came from." });

  // The first paragraph has to answer the question on its own — it is what an
  // answer engine quotes, and it is all most readers see.
  const lede = draft.body.find(b => b.type === "p")?.text ?? "";
  if (lede.split(/\s+/).length < 40) issues.push({ rule: "lede", detail: "Opening paragraph is too short to stand alone as the answer." });

  const links = (text.match(/\]\(\//g) ?? []).length;
  if (links < 2) issues.push({ rule: "internal-links", detail: `${links} internal links; link at least 2 related pages.` });

  const found = FILLER.filter(f => text.toLowerCase().includes(f));
  if (found.length) issues.push({ rule: "voice", detail: `Filler phrasing: ${found.join(", ")}. Cut it — it reads as generated.` });

  // A claim with a number in it and no sources at all is the most expensive
  // kind of mistake this pipeline can publish.
  if (/\d+%|\b₹[\d,]+|\$\d/.test(text) && !(draft.sources?.length)) {
    issues.push({ rule: "citation", detail: "Specific figures with no sources listed." });
  }
  return issues;
}
