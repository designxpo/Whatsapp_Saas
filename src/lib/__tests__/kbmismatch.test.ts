// Finding where two sources state different numbers for the same thing.
//
// This exists because source precedence HIDES disagreements. A brochure that
// contradicts the website is now refused automatically, which is the right
// behaviour for the assistant and the wrong outcome for the brochure: nobody
// learns it is wrong, and it stays wrong in every PDF that goes out.
//
// So detection is separate from resolution. Precedence decides what the
// assistant answers; this decides what somebody needs to go and fix.
//
// It matches on FACTS rather than on file paths, because the two documents
// that disagree rarely use the same heading — "Fees" and "Course Investment"
// never collide, and a path-based check would report nothing while the numbers
// differ.
import { describe, it, expect } from "vitest";
import { findMismatches, type MismatchInput } from "@/lib/kbmismatch";

const c = (over: Partial<MismatchInput> = {}): MismatchInput => ({
  path: "fees/a.md", source: "Brochure", tags: [], body: "", ...over,
});

const feeTable = (programme: string, classroom: string) => [
  "| Program | Classroom Mode |",
  "|---|---|",
  `| **${programme}** | ${classroom} |`,
].join("\n");

describe("prices that disagree", () => {
  it("reports one programme priced differently by two sources", () => {
    const m = findMismatches([
      c({ path: "fees/web.md", source: "knowledge-base-export-website.md", tags: ["website"], body: feeTable("Analytics Edge", "INR 41,300/-") }),
      c({ path: "fees/bro.md", source: "Brochure", body: feeTable("Analytics Edge", "INR 38,000/-") }),
    ]);
    expect(m).toHaveLength(1);
    expect(m[0].subject).toMatch(/Analytics Edge/i);
    expect(m[0].claims.map(x => x.value).sort()).toEqual(["38000", "41300"]);
  });

  it("says nothing when the sources agree", () => {
    expect(findMismatches([
      c({ path: "fees/web.md", source: "website", body: feeTable("Analytics Edge", "INR 41,300/-") }),
      c({ path: "fees/bro.md", source: "Brochure", body: feeTable("Analytics Edge", "INR 41,300/-") }),
    ])).toEqual([]);
  });

  it("reads Indian grouping on both sides before comparing", () => {
    // 1,08,560 against 108560 is the same number written two ways, and
    // reporting it as a conflict would train people to ignore the report.
    expect(findMismatches([
      c({ path: "a.md", source: "website", body: feeTable("Exec Cert", "INR 1,08,560/-") }),
      c({ path: "b.md", source: "Brochure", body: feeTable("Exec Cert", "INR 108560") }),
    ])).toEqual([]);
  });

  it("does not compare a programme against a different programme", () => {
    expect(findMismatches([
      c({ path: "a.md", source: "website", body: feeTable("Analytics Edge", "INR 41,300/-") }),
      c({ path: "b.md", source: "Brochure", body: feeTable("Full Stack AI", "INR 70,800/-") }),
    ])).toEqual([]);
  });

  it("treats two spellings of one programme as one subject", () => {
    // "Adv. Cert. in Data Analytics & AI" and "Advanced Certification in Data
    // Analytics & AI" are the same course. Split apart, a real conflict
    // between them reads as two separate agreeing facts.
    const m = findMismatches([
      c({ path: "a.md", source: "website", body: feeTable("Adv. Cert. in Data Analytics & AI", "INR 87,320/-") }),
      c({ path: "b.md", source: "Brochure", body: feeTable("Advanced Certification in Data Analytics & AI", "INR 85,000/-") }),
    ]);
    expect(m).toHaveLength(1);
  });

  it("ignores a table whose rows are modes rather than programmes", () => {
    // "| Mode | Fee |" names a delivery mode in column one, so three courses'
    // tables all claim the subject "Blended eLearning" and disagree with each
    // other. Nothing here knows which course such a table belongs to.
    expect(findMismatches([
      c({ path: "a.md", source: "website", body: "| Mode | Fee |\n|---|---|\n| Blended eLearning | INR 70,800/- |" }),
      c({ path: "b.md", source: "Brochure", body: "| Mode | Fee |\n|---|---|\n| Blended eLearning | INR 33,040/- |" }),
    ])).toEqual([]);
  });

  it("keeps the column apart — a classroom fee is not a blended fee", () => {
    const wide = (a: string, b: string) => [
      "| Program | Classroom Mode | Blended eLearning |", "|---|---|---|", `| **X** | ${a} | ${b} |`,
    ].join("\n");
    expect(findMismatches([
      c({ path: "a.md", source: "website", body: wide("INR 87,320/-", "INR 70,800/-") }),
      c({ path: "b.md", source: "Brochure", body: wide("INR 87,320/-", "INR 70,800/-") }),
    ])).toEqual([]);
  });
});

describe("other facts that disagree", () => {
  it("does NOT report two durations as a conflict", () => {
    // An area holds many courses. Comparing every duration in "courses"
    // reported 6 against 15 against 8 as a contradiction when it was three
    // different programmes — noise that would train people to ignore the
    // report. A duration belongs to a course, and nothing here knows which.
    expect(findMismatches([
      c({ path: "courses/web.md", source: "website", body: "The course runs 6 months." }),
      c({ path: "courses/bro.md", source: "Brochure", body: "The course runs 8 months." }),
    ])).toEqual([]);
  });

  it("reports a placement rate stated two ways", () => {
    const m = findMismatches([
      c({ path: "p/a.md", source: "website", body: "We record 90% placement." }),
      c({ path: "p/b.md", source: "Brochure", body: "We record 95% placement." }),
    ]);
    expect(m.some(x => x.field === "placement_pct")).toBe(true);
  });

  it("compares an organisation-wide claim wherever it was written", () => {
    // There is one refund rule, not one per area, so these two ARE in
    // conflict even though they sit in different folders.
    const m = findMismatches([
      c({ path: "fees/a.md", source: "website", body: "We offer a 50% fee refund." }),
      c({ path: "policies/b.md", source: "Brochure", body: "We offer a 25% fee refund." }),
    ]);
    expect(m.some(x => x.field === "refund_pct")).toBe(true);
  });
});

describe("what the report tells a person to do", () => {
  const m = () => findMismatches([
    c({ path: "fees/web.md", source: "knowledge-base-export-website.md", tags: ["website"], body: feeTable("Analytics Edge", "INR 41,300/-") }),
    c({ path: "fees/bro.md", source: "Brochure", body: feeTable("Analytics Edge", "INR 38,000/-") }),
  ])[0];

  it("names which source said what, and where", () => {
    const byVal = Object.fromEntries(m().claims.map(x => [x.value, x]));
    expect(byVal["41300"].source).toMatch(/website/i);
    expect(byVal["38000"].path).toBe("fees/bro.md");
  });

  it("says which value the ranking favours, so the fix is obvious", () => {
    expect(m().preferred).toBe("41300");
  });

  it("names the source that needs correcting", () => {
    expect(m().stale.map(s => s.source)).toEqual(["Brochure"]);
  });

  it("puts the most-contested facts first", () => {
    const many = findMismatches([
      c({ path: "a.md", source: "website", body: feeTable("A", "INR 10,000/-") }),
      c({ path: "b.md", source: "Brochure", body: feeTable("A", "INR 20,000/-") }),
      c({ path: "c.md", source: "mail", body: feeTable("A", "INR 30,000/-") }),
      c({ path: "d.md", source: "website", body: feeTable("B", "INR 10,000/-") }),
      c({ path: "e.md", source: "Brochure", body: feeTable("B", "INR 20,000/-") }),
    ]);
    expect(many[0].claims.length).toBeGreaterThanOrEqual(many[1].claims.length);
  });
});
