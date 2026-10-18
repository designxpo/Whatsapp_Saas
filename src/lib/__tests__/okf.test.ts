// Open Knowledge Format (OKF v0.1, Google Cloud, 12 June 2026).
//
// A bundle is a directory of Markdown files. One file is one concept, its PATH
// is its identity, and the YAML front matter requires exactly one field —
// `type`. `title`, `description`, `resource`, `tags` and `timestamp` are
// reserved and optional; beyond those "the producer decides what types exist
// and what other fields each document carries", so an unrecognised field is
// data to preserve, never an error.
//
// These tests are written against the spec rather than against our
// implementation, so a change nobody agreed to fails here instead of shipping.
import { describe, it, expect } from "vitest";
import {
  parseConcept, serialiseConcept, conceptSlug, conceptToText,
  buildIndex, buildIndexes, bundleReport, validateBundle, conceptLinks, decompose,
  type OkfConcept,
} from "@/lib/okf";

const concept = (over: Partial<OkfConcept> = {}): OkfConcept => ({
  path: "courses/data-analytics.md", type: "course", body: "Body text.", ...over,
});

describe("front matter: what the spec requires", () => {
  it("accepts a concept carrying nothing but a type", () => {
    const { concept: c, errors } = parseConcept("notes/x.md", "---\ntype: note\n---\n\nJust a body.");
    expect(errors).toEqual([]);
    expect(c?.type).toBe("note");
    expect(c?.body).toBe("Just a body.");
  });

  it("rejects a concept with no type — the one required field", () => {
    const { concept: c, errors } = parseConcept("notes/x.md", "---\ntitle: No type here\n---\n\nBody.");
    expect(c).toBeNull();
    expect(errors.join(" ")).toMatch(/type/i);
  });

  it("rejects a file with no front matter at all", () => {
    const { concept: c, errors } = parseConcept("notes/x.md", "# Just markdown\n\nNo front matter.");
    expect(c).toBeNull();
    expect(errors.join(" ")).toMatch(/front matter/i);
  });

  it("reads every reserved field", () => {
    const { concept: c } = parseConcept("tables/orders.md", [
      "---",
      "type: BigQuery Table",
      "title: Orders",
      "description: One row per completed customer order.",
      "resource: https://console.cloud.google.com/bigquery?p=acme",
      "tags: [sales, revenue]",
      "timestamp: 2026-06-12",
      "---",
      "",
      "The orders table.",
    ].join("\n"));
    expect(c).toMatchObject({
      type: "BigQuery Table",
      title: "Orders",
      description: "One row per completed customer order.",
      resource: "https://console.cloud.google.com/bigquery?p=acme",
      tags: ["sales", "revenue"],
      timestamp: "2026-06-12",
    });
  });

  it("KEEPS a field the spec does not reserve, because the producer owns those", () => {
    // Dropping these would quietly destroy whatever the author put there.
    const { concept: c, errors } = parseConcept("courses/da.md",
      "---\ntype: course\nfee_inr: 85000\nowner: tanvi\n---\n\nBody.");
    expect(errors).toEqual([]);
    expect(c?.extra).toEqual({ fee_inr: "85000", owner: "tanvi" });
  });

  it("reads tags written as a block list as well as inline", () => {
    const { concept: c } = parseConcept("x/y.md", "---\ntype: t\ntags:\n  - sales\n  - revenue\n---\n\nB.");
    expect(c?.tags).toEqual(["sales", "revenue"]);
  });

  it("leaves a colon inside a value alone", () => {
    const { concept: c } = parseConcept("x/y.md", "---\ntype: t\ntitle: Fees: what they cover\n---\n\nB.");
    expect(c?.title).toBe("Fees: what they cover");
  });

  it("keeps the body verbatim, front matter markers and all", () => {
    const body = "# Heading\n\nPara one.\n\n---\n\nPara after a rule.";
    const { concept: c } = parseConcept("x/y.md", `---\ntype: t\n---\n\n${body}`);
    expect(c?.body).toBe(body);
  });
});

describe("serialise and parse are inverses", () => {
  it("round-trips every reserved field and the extras", () => {
    const original = concept({
      title: "Data Analytics", description: "Flagship course.",
      resource: "https://analytixlabs.co.in/da", tags: ["course", "delhi"],
      timestamp: "2026-10-06", extra: { fee_inr: "85000" },
      body: "## Fees\n\n85,000 INR.",
    });
    const { concept: back, errors } = parseConcept(original.path, serialiseConcept(original));
    expect(errors).toEqual([]);
    expect(back).toEqual(original);
  });

  it("writes type first, so a file is identifiable from its opening lines", () => {
    const out = serialiseConcept(concept());
    expect(out.split("\n").slice(0, 2)).toEqual(["---", "type: course"]);
  });

  it("omits fields that are empty rather than writing blanks", () => {
    const out = serialiseConcept(concept({ title: "", tags: [] }));
    expect(out).not.toMatch(/title:/);
    expect(out).not.toMatch(/tags:/);
  });
});

describe("the path is the identity", () => {
  it("slugs a messy CRM course name into a stable address", () => {
    expect(conceptSlug("Adv. Cert. in Data Analytics & AI")).toBe("adv-cert-in-data-analytics-and-ai");
    expect(conceptSlug("  Fees / EMI  ")).toBe("fees-emi");
    expect(conceptSlug("What is the refund policy?")).toBe("what-is-the-refund-policy");
  });

  it("gives the same name the same address every time", () => {
    expect(conceptSlug("Data Science & AI")).toBe(conceptSlug("data science and ai"));
  });

  it("never produces an empty or unsafe path segment", () => {
    expect(conceptSlug("???")).toBe("untitled");
    expect(conceptSlug("../../etc/passwd")).toBe("etc-passwd");
  });
});

describe("a bundle has to hold together", () => {
  it("passes a clean bundle", () => {
    expect(validateBundle([
      concept({ path: "courses/da.md" }),
      concept({ path: "courses/ds.md" }),
    ])).toEqual([]);
  });

  it("catches two concepts claiming the same address", () => {
    const errs = validateBundle([concept({ path: "courses/da.md" }), concept({ path: "courses/da.md" })]);
    expect(errs.join(" ")).toMatch(/courses\/da\.md/);
  });

  it("catches a link that points at no concept", () => {
    const errs = validateBundle([
      concept({ path: "courses/da.md", body: "See [fees](../fees/tuition.md)." }),
    ]);
    expect(errs.join(" ")).toMatch(/fees\/tuition\.md/);
  });

  it("accepts a link that resolves, relative to the linking file", () => {
    expect(validateBundle([
      concept({ path: "courses/da.md", body: "See [fees](../fees/tuition.md)." }),
      concept({ path: "fees/tuition.md" }),
    ])).toEqual([]);
  });

  it("leaves external links alone", () => {
    expect(validateBundle([
      concept({ body: "See [site](https://analytixlabs.co.in) and [mail](mailto:a@b.c)." }),
    ])).toEqual([]);
  });

  it("finds the links in a body", () => {
    expect(conceptLinks("[a](x/one.md) text [b](../two.md) [ext](https://e.com)"))
      .toEqual(["x/one.md", "../two.md"]);
  });
});

describe("index.md — the entry point an agent reads first", () => {
  const concepts = [
    concept({ path: "courses/da.md", type: "course", title: "Data Analytics", description: "Flagship." }),
    concept({ path: "courses/ds.md", type: "course", title: "Data Science" }),
    concept({ path: "fees/refund.md", type: "policy", title: "Refund policy" }),
  ];

  it("lists every concept, grouped by type", () => {
    const idx = buildIndex("AnalytixLabs knowledge", concepts);
    expect(idx).toMatch(/## course/);
    expect(idx).toMatch(/## policy/);
    expect(idx).toMatch(/\[Data Analytics\]\(courses\/da\.md\)/);
    expect(idx).toMatch(/\[Refund policy\]\(fees\/refund\.md\)/);
  });

  it("carries the one-line description, which is what makes it skimmable", () => {
    // Progressive disclosure: the agent decides what to open from the index
    // alone, so a bare list of links would make it open everything.
    expect(buildIndex("t", concepts)).toMatch(/\[Data Analytics\]\(courses\/da\.md\) — Flagship\./);
  });

  it("falls back to the path when a concept has no title", () => {
    expect(buildIndex("t", [concept({ path: "misc/x.md", title: undefined })])).toMatch(/\[misc\/x\.md\]\(misc\/x\.md\)/);
  });
});

describe("decomposing an existing document into concepts", () => {
  const doc = { title: "AnalytixLabs FAQ", tag: "FAQ" };
  const text = [
    "## What is the fee?", "", "The fee is 85,000 INR.", "",
    "## Where are the centres?", "", "Noida, Gurgaon and Bangalore.", "",
    "## What is the refund policy?", "", "50% refund if not placed in 6 months.",
  ].join("\n");

  it("makes one concept per heading, not one per 1000 characters", () => {
    const out = decompose(doc, text, { type: "faq", area: "faq" });
    expect(out).toHaveLength(3);
    expect(out.map(c => c.title)).toEqual([
      "What is the fee?", "Where are the centres?", "What is the refund policy?",
    ]);
  });

  it("addresses each concept by its heading, under the given area", () => {
    const out = decompose(doc, text, { type: "faq", area: "faq" });
    expect(out[0].path).toBe("faq/what-is-the-fee.md");
  });

  it("carries the source document's tag through, so channel scoping survives", () => {
    // Channels pick a KB by kb_tag; losing it would send every number the
    // whole corpus.
    const out = decompose(doc, text, { type: "faq", area: "faq" });
    expect(out[0].tags).toContain("FAQ");
  });

  it("keeps the answer with its question", () => {
    const out = decompose(doc, text, { type: "faq", area: "faq" });
    expect(out[0].body).toContain("85,000 INR");
    expect(out[0].body).not.toContain("Noida");
  });

  it("records where the concept came from, so it can be traced back", () => {
    const out = decompose(doc, text, { type: "faq", area: "faq" });
    expect(out[0].extra?.source).toBe("AnalytixLabs FAQ");
  });

  it("gives a second concept with the same heading a distinct address", () => {
    const dup = ["## Fees", "", "A.", "", "## Fees", "", "B."].join("\n");
    const out = decompose(doc, dup, { type: "faq", area: "faq" });
    expect(out.map(c => c.path)).toEqual(["faq/fees.md", "faq/fees-2.md"]);
  });

  it("keeps text that appears before any heading rather than dropping it", () => {
    const out = decompose(doc, "Intro with no heading.\n\n## Fees\n\n85,000.", { type: "faq", area: "faq" });
    expect(out.map(c => c.body).join("\n")).toContain("Intro with no heading.");
  });

  it("produces nothing from an empty document instead of an empty concept", () => {
    expect(decompose(doc, "   ", { type: "faq", area: "faq" })).toEqual([]);
  });
});

describe("feeding the existing retrieval index", () => {
  it("renders a concept as text that still names its document and section", () => {
    // retrieve() ranks on these headers today; the bundle must not lose them
    // or every stored embedding changes meaning at once.
    const text = conceptToText(concept({
      path: "faq/what-is-the-fee.md", title: "What is the fee?", body: "85,000 INR.",
    }));
    expect(text).toContain("What is the fee?");
    expect(text).toContain("85,000 INR.");
  });

  it("includes the description, which often carries the answer in one line", () => {
    expect(conceptToText(concept({ title: "Refund", description: "50% if unplaced.", body: "Details." })))
      .toContain("50% if unplaced.");
  });
});

// ── Everything below was written after running the decomposer over the real
// 1,819-chunk corpus. Each case is a fault that run exposed and the unit tests
// above could not, because they used fixtures with tidy headings.

describe("documents whose headings did not survive extraction", () => {
  // Four of the ten live documents are PDFs or exports with no markdown
  // headings left. Decomposing by heading gave each of them ONE concept —
  // 174,437 characters in the worst case. That is not a concept, it is the
  // original blob with front matter stapled on, and it is unnavigable.
  const long = (n: number) => Array.from({ length: n }, (_, i) => `Paragraph ${i} with enough text to count.`).join("\n\n");

  it("splits a heading-less document instead of emitting one huge concept", () => {
    const out = decompose({ title: "Master PDF" }, long(400), { type: "knowledge", area: "master" });
    expect(out.length).toBeGreaterThan(1);
    for (const c of out) expect(c.body.length).toBeLessThanOrEqual(8000);
  });

  it("splits only on paragraph boundaries, never mid-sentence", () => {
    const out = decompose({ title: "Master PDF" }, long(400), { type: "knowledge", area: "master" });
    for (const c of out) expect(c.body.trim()).toMatch(/\.$/);
  });

  it("says which part it is, so the pieces stay orderable", () => {
    const out = decompose({ title: "Master PDF" }, long(400), { type: "knowledge", area: "master" });
    expect(out[0].title).toMatch(/Master PDF/);
    expect(out[1].path).not.toBe(out[0].path);
  });

  it("marks them, because a split like this is a migration shortcut not a structure", () => {
    // Somebody has to come back and give these real headings. A flag in the
    // front matter is how they find them without re-reading the whole bundle.
    const out = decompose({ title: "Master PDF" }, long(400), { type: "knowledge", area: "master" });
    expect(out[0].extra?.needs_review).toBe("split without headings");
  });

  it("leaves a properly headed document alone", () => {
    const out = decompose({ title: "FAQ" }, "## A\n\nOne.\n\n## B\n\nTwo.", { type: "faq", area: "faq" });
    expect(out.map(c => c.extra?.needs_review)).toEqual([undefined, undefined]);
  });

  it("splits an oversized SECTION of an otherwise headed document too", () => {
    const text = `## Small\n\nShort.\n\n## Huge\n\n${long(400)}`;
    const out = decompose({ title: "Mixed" }, text, { type: "knowledge", area: "mixed" });
    expect(out.length).toBeGreaterThan(2);
    for (const c of out) expect(c.body.length).toBeLessThanOrEqual(8000);
  });
});

describe("index.md has to stay small enough to be read", () => {
  // A single flat index over the real corpus came to 130k characters — 33k
  // tokens before the agent has opened anything. An entry point that costs
  // more than the answer is not an entry point.
  const many = Array.from({ length: 300 }, (_, i) => concept({
    path: `${i < 150 ? "website" : "faq"}/c${i}.md`, type: i < 150 ? "page" : "faq", title: `Concept ${i}`,
  }));

  it("splits into one index per area, with a root index pointing at them", () => {
    const { root, areas } = buildIndexes("AnalytixLabs knowledge", many);
    expect(Object.keys(areas).sort()).toEqual(["faq/index.md", "website/index.md"]);
    expect(root).toMatch(/\[website\]\(website\/index\.md\)/);
    expect(root).toMatch(/\[faq\]\(faq\/index\.md\)/);
  });

  it("keeps the root index tiny — it is read on every navigation", () => {
    const { root } = buildIndexes("t", many);
    expect(root.length).toBeLessThan(2000);
  });

  it("says how big each area is, so the agent can judge before opening", () => {
    const { root } = buildIndexes("t", many);
    expect(root).toMatch(/150 concepts/);
  });

  it("lists an area's own concepts in its area index, not in the root", () => {
    const { root, areas } = buildIndexes("t", many);
    expect(areas["faq/index.md"]).toMatch(/\[Concept 299\]\(c299\.md\)/);   // relative to the area
    expect(root).not.toMatch(/Concept 299/);
  });
});

describe("the bundle report — what a human has to go and fix", () => {
  it("names the concepts nobody can use", () => {
    const r = bundleReport([
      concept({ path: "a/tiny.md", body: "ok" }),
      concept({ path: "a/big.md", body: "x".repeat(9000) }),
      concept({ path: "a/fine.md", body: "y".repeat(500) }),
      concept({ path: "a/raw.md", extra: { needs_review: "split without headings" } }),
    ]);
    expect(r.tiny).toContain("a/tiny.md");
    expect(r.oversized).toContain("a/big.md");
    expect(r.needsReview).toContain("a/raw.md");
    expect(r.tiny).not.toContain("a/fine.md");
  });

  it("counts what it found, so a build can fail on a threshold", () => {
    const r = bundleReport([concept({ path: "a/t.md", body: "ok" })]);
    expect(r.total).toBe(1);
  });
});

describe("an address has to fit, and has to be readable", () => {
  // Found by running the decomposer over the real corpus: blog-article
  // headings produced ninety-character filenames, which overflow tar's
  // 100-byte name field and make a poor address regardless — the path is what
  // a person types and an agent follows.
  const long = "4. What is the difference between cognitive analytics, predictive and prescriptive analytics?";

  it("bounds a very long heading", () => {
    expect(conceptSlug(long).length).toBeLessThanOrEqual(60);
  });

  it("cuts at a word boundary, not mid-syllable", () => {
    expect(conceptSlug(long)).not.toMatch(/-$/);
    expect(conceptSlug(long).split("-").pop()!.length).toBeGreaterThan(1);
  });

  it("still starts with the words that identify it", () => {
    expect(conceptSlug(long)).toMatch(/^4-what-is-the-difference/);
  });

  it("leaves a normal heading untouched", () => {
    expect(conceptSlug("What is the refund policy?")).toBe("what-is-the-refund-policy");
  });

  it("keeps the whole path inside tar's 100-byte name field", () => {
    expect(`courses/${conceptSlug(long)}.md`.length).toBeLessThanOrEqual(100);
  });
});

describe("tables and the numbers in them", () => {
  const feeTable = [
    "## Fees",
    "",
    "| Program | Classroom Mode | Blended eLearning |",
    "|---|---|---|",
    "| **Adv. Cert. in Data Analytics & AI** | INR 87,320/- | INR 70,800/- |",
    "| **Analytics Edge** | INR 41,300/- | INR 33,040/- |",
    "",
    "Fees run 6 months and include 90% placement support.",
  ].join("\n");

  it("keeps a table whole inside its concept", () => {
    // Half a fee table is a column of figures with no programme beside them,
    // which is precisely how a price gets quoted against the wrong course.
    const [c] = decompose({ title: "Brochure" }, feeTable, { type: "policy", area: "fees" });
    expect(c.body).toContain("| **Adv. Cert. in Data Analytics & AI** | INR 87,320/- | INR 70,800/- |");
    expect(c.body).toContain("| **Analytics Edge** | INR 41,300/- | INR 33,040/- |");
  });

  it("lifts the prices into front matter where they can be checked", () => {
    const [c] = decompose({ title: "Brochure" }, feeTable, { type: "policy", area: "fees" });
    expect(c.extra?.price_min_inr).toBe("33040");
    expect(c.extra?.price_max_inr).toBe("87320");
  });

  it("records the duration and placement rate as fields too", () => {
    const [c] = decompose({ title: "Brochure" }, feeTable, { type: "policy", area: "fees" });
    expect(c.extra?.duration_months).toBe("6");
    expect(c.extra?.placement_pct).toBe("90");
  });

  it("notes that the concept contains a table", () => {
    const [c] = decompose({ title: "Brochure" }, feeTable, { type: "policy", area: "fees" });
    expect(c.extra?.tables).toBe("1");
  });

  it("survives the round trip, front matter and table alike", () => {
    const [c] = decompose({ title: "Brochure" }, feeTable, { type: "policy", area: "fees" });
    const { concept: back } = parseConcept(c.path, serialiseConcept(c));
    expect(back?.extra?.price_max_inr).toBe("87320");
    expect(back?.body).toContain("| **Analytics Edge** |");
  });

  it("adds no price fields to a concept that has no prices", () => {
    const [c] = decompose({ title: "Doc" }, "## About us\n\nWe have taught learners since 2011 and run three centres.", { type: "company", area: "company" });
    expect(c.extra?.price_min_inr).toBeUndefined();
  });
});
