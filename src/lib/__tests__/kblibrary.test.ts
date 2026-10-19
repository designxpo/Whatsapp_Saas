// The OKF library: a fixed spine of subject areas, and the rules that decide
// where an uploaded concept goes and whether it may go live.
//
// The whole point is that anyone can upload anything without the library's
// shape depending on who uploaded it. So: uploads may not invent areas, a
// concept nobody can place is reviewed rather than guessed at, and an upload
// that contradicts a live answer is quarantined instead of published.
import { describe, it, expect } from "vitest";
import {
  AREA_HINTS, hintTypes,
  classifyByKeywords, reconcile, comparableFacts, factsDisagree, sourceRank, relatedConcept,
  type LibraryConcept,
} from "@/lib/kblibrary";
import { parseMoney } from "@/lib/okffacts";

const concept = (over: Partial<LibraryConcept> = {}): LibraryConcept => ({
  path: "faq/x.md", type: "faq", title: "X", body: "Body.", tags: [], status: "active",
  source: "Brochure", ...over,
});

describe("the fallback hints", () => {
  // These are NOT the list of areas a workspace may have — areas are inferred from
  // content (kbareas.ts). They are the offline fallback used when no AI key is set.
  it("are non-empty and each has a slug, title and description", () => {
    expect(AREA_HINTS.length).toBeGreaterThan(5);
    for (const a of AREA_HINTS) {
      expect(a.slug, JSON.stringify(a)).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(a.title.trim().length).toBeGreaterThan(0);
      expect(a.description.trim().length, a.slug).toBeGreaterThan(20);
    }
  });

  it("have no duplicate slugs — the slug is a directory name", () => {
    const slugs = AREA_HINTS.map(a => a.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("stay industry-neutral — no hint may name a particular business or trade", () => {
    const text = JSON.stringify(AREA_HINTS).toLowerCase();
    for (const banned of ["analytix", "placement", "curriculum", "syllabus", "masterclass", "tuition", "noida", "gurgaon", "student"]) {
      expect(text, `hint mentions "${banned}"`).not.toMatch(new RegExp(`\\b${banned}`));
    }
  });

  it("imply a concept type only for a known hint", () => {
    expect(hintTypes("pricing")).toContain("pricing");
    expect(hintTypes("PRICING")).toContain("pricing");        // case is not a new area
    expect(hintTypes("room-types")).toBeNull();               // any other area is simply inferred
  });
});

describe("filing an uploaded concept", () => {
  const file = (text: string) => classifyByKeywords(text);

  it("files fees talk under fees", () => {
    expect(file("The course fee is 85,000 INR and EMI options are available.").area).toBe("pricing");
  });

  it("files a location question under locations", () => {
    expect(file("Our main branch address is on Station Road, open on weekends, near the metro.").area).toBe("locations");
  });

  it("files result claims under outcomes", () => {
    expect(file("Customer results speak for themselves: a 90% satisfaction rating, guaranteed outcomes and many testimonials.").area).toBe("outcomes");
  });

  it("files eligibility and booking under booking", () => {
    expect(file("Eligibility: any adult. The next slot starts on 2 November; book online.").area).toBe("booking");
  });

  it("files a product description under products", () => {
    expect(file("The Premium plan includes three services, with options and variants listed in the product catalogue.").area).toBe("products");
  });

  it("refuses to guess when nothing matches", () => {
    // A concept filed into the wrong area is worse than one a human looks at:
    // it is findable only by accident and nobody knows it is misfiled.
    const r = file("The quick brown fox jumped over the lazy dog.");
    expect(r.area).toBeNull();
    expect(r.confidence).toBe(0);
  });

  it("refuses to guess when two areas tie", () => {
    // Equal evidence for two areas is not a 50/50 bet worth taking silently.
    const r = file("fee fee support support");
    expect(r.area).toBeNull();
  });

  it("reports a confidence a caller can threshold on", () => {
    const strong = file("Fees, EMI, instalments, payment plan, discount and refund of the product price.");
    expect(strong.confidence).toBeGreaterThan(0);
    expect(strong.area).toBe("pricing");
  });
});

describe("comparing the facts two concepts state", () => {
  it("pulls out the figures a lead would act on", () => {
    const f = comparableFacts("Fee is ₹85,000 for 6 months with 90% placement and 50% refund.");
    expect(f.money).toContain("85000");
    expect(f.months).toContain("6");
    expect(f.percents).toEqual(expect.arrayContaining(["90", "50"]));
  });

  it("reads ₹ and Rs and bare lakh figures alike", () => {
    expect(comparableFacts("Rs. 85,000").money).toContain("85000");
    expect(comparableFacts("₹6 lakh").money).toContain("600000");
    expect(comparableFacts("6 LPA").money).toContain("600000");
  });

  it("sees no disagreement between two phrasings of the same facts", () => {
    expect(factsDisagree(
      "The fee is ₹85,000 and the course runs 6 months.",
      "Course duration 6 months. Fee: Rs 85,000.",
    )).toBe(false);
  });

  it("sees a disagreement when a figure actually changes", () => {
    expect(factsDisagree("The fee is ₹85,000.", "The fee is ₹90,000.")).toBe(true);
  });

  it("does not call it a disagreement when one side simply says less", () => {
    // A short summary that omits the duration is not a contradiction, and
    // treating it as one would fill the review queue with noise.
    expect(factsDisagree("Fee ₹85,000, runs 6 months.", "Fee ₹85,000.")).toBe(false);
  });

  it("ignores prose differences entirely", () => {
    expect(factsDisagree("Our flagship programme costs ₹85,000.", "Price: ₹85,000. Enrol today!")).toBe(false);
  });
});

describe("reconcile — what an upload is allowed to do to a live answer", () => {
  const existing = concept({ path: "pricing/tuition.md", body: "The fee is ₹85,000 for 6 months.", tags: ["website"] });

  it("publishes a concept on a subject nothing covers yet", () => {
    const r = reconcile(concept({ path: "pricing/new.md", body: "Scholarships are available." }), []);
    expect(r.action).toBe("publish");
    expect(r.concept.status).toBe("active");
  });

  it("merges a restatement that agrees, keeping one canonical concept", () => {
    const incoming = concept({ path: "pricing/tuition.md", body: "Fee: Rs 85,000. Duration 6 months.", tags: ["brochure"], source: "Brochure" });
    const r = reconcile(incoming, [existing]);
    expect(r.action).toBe("merge");
    expect(r.concept.status).toBe("active");
  });

  it("unions the tags on a merge, so no channel loses access", () => {
    // wa_channels.kb_tag filters on tags. Dropping one would silently cut a
    // number off from knowledge it can reach today.
    const incoming = concept({ path: "pricing/tuition.md", body: "Fee: Rs 85,000.", tags: ["brochure"] });
    const r = reconcile(incoming, [existing]);
    expect(r.concept.tags.sort()).toEqual(["brochure", "website"]);
  });

  it("records every source a merged concept came from", () => {
    const incoming = concept({ path: "pricing/tuition.md", body: "Fee: Rs 85,000.", source: "Brochure" });
    const r = reconcile(incoming, [concept({ ...existing, source: "Website export" })]);
    expect(r.concept.sources.sort()).toEqual(["Brochure", "Website export"]);
  });

  it("QUARANTINES an upload that contradicts an EQUALLY trusted live answer", () => {
    // The guarantee the whole design exists for: an upload can never silently
    // change what the bot tells a lead. Where the two sources rank the same,
    // no ranking can settle it and a person decides.
    const sameRank = concept({ ...existing, tags: [], source: "Brochure", sources: ["Brochure"] });
    const incoming = concept({ path: "pricing/tuition.md", body: "The fee is ₹90,000 for 6 months.", source: "Brochure" });
    const r = reconcile(incoming, [sameRank]);
    expect(r.action).toBe("quarantine");
    expect(r.concept.status).toBe("pending");
  });

  it("never lets a contradiction go live on a lower-ranked source", () => {
    // existing is website-tagged; the incoming brochure is outranked, so the
    // published answer stands and the newcomer is filed away, not queued.
    const incoming = concept({ path: "pricing/tuition.md", body: "The fee is ₹90,000 for 6 months.", source: "Brochure" });
    const r = reconcile(incoming, [existing]);
    expect(r.concept.status).not.toBe("active");
    expect(r.supersede).toEqual([]);
  });

  it("leaves the live answer live while the conflict waits", () => {
    const incoming = concept({ path: "pricing/tuition.md", body: "The fee is ₹90,000." });
    const r = reconcile(incoming, [existing]);
    expect(r.supersede).toEqual([]);                 // nothing is retired on a conflict
    expect(existing.status).toBe("active");          // untouched
  });

  it("explains the conflict in terms a person can act on", () => {
    const incoming = concept({ path: "pricing/tuition.md", body: "The fee is ₹90,000." });
    const r = reconcile(incoming, [existing]);
    expect(r.reason).toMatch(/85000/);
    expect(r.reason).toMatch(/90000/);
  });

  it("holds a concept nobody could file, rather than dumping it somewhere", () => {
    const r = reconcile(concept({ path: "", body: "Lorem ipsum." }), [], { area: null });
    expect(r.action).toBe("quarantine");
    expect(r.reason).toMatch(/could not be filed|area/i);
  });

  it("never returns a pending concept as indexable", () => {
    const incoming = concept({ path: "pricing/tuition.md", body: "The fee is ₹90,000." });
    expect(reconcile(incoming, [existing]).concept.status).not.toBe("active");
  });
});

describe("which source wins when two disagree", () => {
  // Priority set by Priyesh, 6 Oct 2026: the website is maintained and public,
  // so it is the most current; the brochure is a snapshot that goes stale;
  // everything else is older still.
  it("ranks website above brochure above the rest", () => {
    expect(sourceRank("knowledge-base-export-website.md")).toBeLessThan(sourceRank("Brochure"));
    expect(sourceRank("Brochure")).toBeLessThan(sourceRank("analytixlabs_knowledge_base_mail.md"));
  });

  it("recognises the website whether it is named in the title or the tag", () => {
    expect(sourceRank("AnalytixLabs FAQ (website)")).toBe(sourceRank("knowledge-base-export-website.md"));
    expect(sourceRank("KNOWLEDGE_BASE_MASTER.pdf", ["Website"])).toBe(sourceRank("knowledge-base-export-website.md"));
  });

  it("gives an unknown source the lowest rank rather than refusing it", () => {
    expect(sourceRank("Some file nobody listed.docx")).toBeGreaterThan(sourceRank("Brochure"));
  });

  it("publishes a better-sourced contradiction and retires the old answer", () => {
    const livePrice = concept({ path: "pricing/tuition.md", body: "The programme fee is ₹85,000 for 6 months.", source: "Brochure", sources: ["Brochure"] });
    const incoming = concept({ path: "pricing/tuition.md", body: "The programme fee is ₹87,320 for 6 months.", source: "knowledge-base-export-website.md" });
    const r = reconcile(incoming, [livePrice]);
    expect(r.action).toBe("publish");
    expect(r.supersede).toEqual(["pricing/tuition.md"]);
    expect(r.reason).toMatch(/website/i);
  });

  it("refuses a worse-sourced contradiction outright, leaving the live answer alone", () => {
    const liveWeb = concept({ path: "pricing/tuition.md", body: "The programme fee is ₹87,320 for 6 months.", source: "knowledge-base-export-website.md", sources: ["knowledge-base-export-website.md"] });
    const stale = concept({ path: "pricing/tuition.md", body: "The programme fee is ₹85,000 for 6 months.", source: "Brochure" });
    const r = reconcile(stale, [liveWeb]);
    expect(r.action).toBe("supersede-incoming");
    expect(r.supersede).toEqual([]);
    expect(r.reason).toMatch(/lower priority|outranked/i);
  });

  it("still asks a person when two EQUAL sources disagree", () => {
    // Precedence can only settle a conflict between different sources. Two
    // brochures disagreeing is a question about the content, not the ranking.
    const live = concept({ path: "pricing/tuition.md", body: "Fee ₹85,000 for 6 months.", source: "Brochure", sources: ["Brochure"] });
    const other = concept({ path: "pricing/tuition.md", body: "Fee ₹90,000 for 6 months.", source: "Brochure" });
    expect(reconcile(other, [live]).action).toBe("quarantine");
  });

  it("does not let precedence override agreement — a restatement still merges", () => {
    const live = concept({ path: "pricing/tuition.md", body: "Fee ₹85,000 for 6 months.", source: "Brochure", sources: ["Brochure"], tags: ["brochure"] });
    const web = concept({ path: "pricing/tuition.md", body: "The fee is Rs 85,000, over 6 months.", source: "knowledge-base-export-website.md", tags: ["website"] });
    const r = reconcile(web, [live]);
    expect(r.action).toBe("merge");
    expect(r.concept.tags.sort()).toEqual(["brochure", "website"]);
  });
})

describe("a keyword is a word, not a run of letters", () => {
  // Found by auditing the classifier against ordinary English. Both of these
  // filed with FULL confidence, which is the worst combination: wrong and
  // certain. "fee" sits inside "coffee"; "emi" sits inside "academic".
  it("does not find a fee inside coffee", () => {
    expect(classifyByKeywords("We serve free coffee in the lounge.").area).not.toBe("pricing");
  });

  it("does not find EMI inside academic", () => {
    expect(classifyByKeywords("Our academic standards are high.").area).not.toBe("pricing");
  });

  it("does not find a job inside jobbing or a role inside enrolled", () => {
    expect(classifyByKeywords("The student enrolled last week.").area).not.toBe("outcomes");
  });

  it("still matches the words it is meant to", () => {
    expect(classifyByKeywords("The course fee is ₹85,000 with EMI available.").area).toBe("pricing");
    expect(classifyByKeywords("Our Noida centre has a classroom at that address.").area).toBe("locations");
  });

  it("still matches an inflection of a longer stem", () => {
    // "eligib" has to reach "eligibility" without every form being listed.
    expect(classifyByKeywords("Eligibility: any graduate may apply for admission to the batch.").area).toBe("booking");
    expect(classifyByKeywords("We are accredited and our accreditation is current since 2011.").area).toBe("company");
  });
});

describe("finding the concept an upload is really about", () => {
  // reconcile() only ever compared two concepts that landed on the SAME path,
  // and paths come from headings. Over the real corpus that matched 8 times in
  // 1,515 concepts: "Fees" and "Course Investment" are the same subject and
  // never met, so the nine-way restatement problem went undetected and the
  // conflict check had almost nothing to check.
  const existing = [
    concept({ path: "pricing/course-investment.md", title: "Course Investment", body: "| Program | Classroom |\n|---|---|\n| **Analytics Edge** | INR 41,300/- |" }),
    concept({ path: "locations/noida.md", title: "Noida centre", body: "Our Noida centre is in Sector 2." }),
  ];

  it("still matches an identical path", () => {
    const same = concept({ path: "locations/noida.md", title: "Noida centre", body: "Sector 2, Noida." });
    expect(relatedConcept(same, existing)?.path).toBe("locations/noida.md");
  });

  it("matches a different heading that prices the same programme", () => {
    const fees = concept({ path: "pricing/fees.md", title: "Fees", body: "| Program | Classroom |\n|---|---|\n| **Analytics Edge** | INR 41,300/- |" });
    expect(relatedConcept(fees, existing)?.path).toBe("pricing/course-investment.md");
  });

  it("matches a near-identical title in the same area", () => {
    const near = concept({ path: "locations/our-noida-centre.md", title: "Our Noida Centre", body: "Sector 2." });
    expect(relatedConcept(near, existing)?.path).toBe("locations/noida.md");
  });

  it("does not match across areas on a coincidental title", () => {
    const other = concept({ path: "products/noida.md", title: "Noida centre", body: "x" });
    expect(relatedConcept(other, existing)).toBeNull();
  });

  it("does not match two concepts that merely share a word", () => {
    const unrelated = concept({ path: "locations/centre-timings.md", title: "Centre timings", body: "Classes run 10 to 6." });
    expect(relatedConcept(unrelated, existing)).toBeNull();
  });

  it("only considers published concepts", () => {
    const pending = [concept({ ...existing[1], status: "pending" })];
    expect(relatedConcept(concept({ path: "locations/noida.md", title: "Noida centre", body: "x" }), pending)).toBeNull();
  });

  it("lets reconcile catch a contradiction under a different heading", () => {
    // The payoff: the brochure saying 38,000 under "Fees" now meets the
    // website saying 41,300 under "Course Investment".
    const cheaper = concept({
      path: "pricing/fees.md", title: "Fees", source: "Brochure",
      body: "| Program | Classroom |\n|---|---|\n| **Analytics Edge** | INR 38,000/- |",
    });
    const live = [concept({ ...existing[0], source: "Brochure", sources: ["Brochure"] })];
    expect(reconcile(cheaper, live).action).toBe("quarantine");
  });
});

describe("the money this knowledge base is actually written in", () => {
  // Every fee table here says "INR 41,300/-". comparableFacts knew only the
  // rupee sign and "Rs.", so it found no money in any of them: two tables
  // quoting different fees compared as equal, and a real contradiction merged
  // without a word.
  it("reads INR, which is the form the fee tables use", () => {
    expect(comparableFacts("| Analytics Edge | INR 41,300/- |").money).toEqual(["41300"]);
  });

  it("sees a disagreement between two INR figures", () => {
    expect(factsDisagree("INR 41,300/-", "INR 38,000/-")).toBe(true);
  });

  it("reads all three notations the same way", () => {
    for (const t of ["INR 85,000", "₹85,000", "Rs. 85,000"]) {
      expect(comparableFacts(t).money, t).toEqual(["85000"]);
    }
  });

  it("agrees with parseMoney, which is the other parser in the codebase", () => {
    // Two money parsers exist. They must not drift: the whole bug above was
    // one of them knowing a notation the other did not.
    for (const t of ["INR 1,08,560/-", "₹6 lakh", "Rs. 70,800", "10 LPA"]) {
      expect(Number(comparableFacts(t).money[0]), t).toBe(parseMoney(t));
    }
  });
});

describe("what must never be treated as the same subject", () => {
  // Measured against the real corpus: at a 0.6 title threshold these matched,
  // and merging them would have filed one course's fees and syllabus under
  // the other's name. Worse than never matching.
  const live = [
    concept({ path: "products/advanced-certification-in-data-science-and-genai.md", title: "Advanced Certification in Data Science & GenAI", body: "Syllabus A." }),
    concept({ path: "products/knowledge-base-master-pdf-part-1-of-24.md", title: "KNOWLEDGE_BASE_MASTER.pdf (part 1 of 24)", body: "Fragment one." }),
  ];

  it("keeps two different certifications apart", () => {
    const other = concept({ path: "products/advanced-certification-in-data-analytics-and-ai.md", title: "Advanced Certification in Data Analytics & AI", body: "Syllabus B." });
    expect(relatedConcept(other, live)).toBeNull();
  });

  it("keeps the Executive certification apart from the Advanced one", () => {
    const exec = concept({ path: "products/executive-certification.md", title: "Executive Certification in Data Science with AI Specialization", body: "Syllabus C." });
    expect(relatedConcept(exec, live)).toBeNull();
  });

  it("never folds a numbered split back into its first fragment", () => {
    const part = concept({ path: "products/knowledge-base-master-pdf-part-2-of-24.md", title: "KNOWLEDGE_BASE_MASTER.pdf (part 2 of 24)", body: "Fragment two." });
    expect(relatedConcept(part, live)).toBeNull();
  });

  it("still matches a genuine restatement", () => {
    const same = concept({ path: "policies/privacy.md", title: "Privacy Policy", body: "x" });
    const withPolicy = [concept({ path: "policies/privacy-policy.md", title: "Privacy Policy", body: "y" })];
    expect(relatedConcept(same, withPolicy)?.path).toBe("policies/privacy-policy.md");
  });

  it("refuses to match on boilerplate alone", () => {
    // "Course details" against "Course information" is two generic headings,
    // not one subject.
    const a = concept({ path: "products/course-details.md", title: "Course details", body: "x" });
    const b = [concept({ path: "products/course-information.md", title: "Course information", body: "y" })];
    expect(relatedConcept(a, b)).toBeNull();
  });
});
