// The gate before switching the library on.
//
// The thing these tests most need to prevent is a FALSE GREEN: a verdict that
// says "ready" when a question the assistant used to answer now returns
// nothing. A cutover licensed by a number nobody checked is the expensive
// failure here, so the verdict is pinned as conservative on purpose.
import { describe, it, expect } from "vitest";
import { agreementScore, verdict, type EvalReport, type EvalCase } from "@/lib/kbeval";

const c = (over: Partial<EvalCase> = {}): EvalCase => ({
  question: "what is the fee",
  documents: { found: 3, top: 0.9, text: "The fee is 85,000" },
  concepts: { found: 3, top: 0.9, text: "The fee is 85,000" },
  agreement: 1, lost: false, gained: false, ...over,
});

const report = (cases: EvalCase[]): EvalReport => ({
  cases,
  total: cases.length,
  coveredBefore: cases.filter(x => x.documents.found > 0).length,
  coveredAfter: cases.filter(x => x.concepts.found > 0).length,
  lost: cases.filter(x => x.lost).length,
  gained: cases.filter(x => x.gained).length,
  meanAgreement: 1,
  needsReading: cases.filter(x => x.lost || x.agreement < 0.5),
});

describe("agreement between two retrievals", () => {
  it("is 1 for the same text", () => {
    expect(agreementScore("the programme fee is 85,000 rupees", "the programme fee is 85,000 rupees")).toBe(1);
  });

  it("is high for the same facts worded differently", () => {
    expect(agreementScore(
      "The programme fee is 85,000 and instalments are available",
      "Instalments available. The programme fee is 85,000.",
    )).toBeGreaterThan(0.7);
  });

  it("is low for unrelated material", () => {
    expect(agreementScore(
      "The programme fee is 85,000 rupees",
      "Our Noida centre runs weekend classroom batches",
    )).toBeLessThan(0.2);
  });

  it("is 0 when one side found nothing", () => {
    expect(agreementScore("anything at all here", "")).toBe(0);
  });

  it("ignores short filler words rather than scoring on them", () => {
    // "the", "is", "a" match everywhere and would make every pair look alike.
    expect(agreementScore("the fee is a cost", "the batch is a date")).toBeLessThan(0.4);
  });
});

describe("the verdict", () => {
  it("refuses when a question that was answered now returns nothing", () => {
    // The one unambiguous regression: a lead who would have got an answer now
    // gets silence. No average can outweigh it.
    const v = verdict(report([c(), c({ lost: true, concepts: { found: 0, top: 0, text: "" } })]));
    expect(v.ready).toBe(false);
    expect(v.reason).toMatch(/return nothing|answered/i);
  });

  it("refuses when overall coverage drops, even with nothing flagged lost", () => {
    const r = report([c(), c()]);
    r.coveredAfter = 1;
    expect(verdict(r).ready).toBe(false);
  });

  it("refuses when there is nothing to evaluate", () => {
    // An empty question set scores perfectly on every metric, which is exactly
    // why it must not read as a pass.
    expect(verdict(report([])).ready).toBe(false);
  });

  it("allows a switch when coverage holds", () => {
    const v = verdict(report([c(), c()]));
    expect(v.ready).toBe(true);
  });

  it("still tells a reader what to check before switching", () => {
    const v = verdict(report([c(), c({ agreement: 0.2 })]));
    expect(v.ready).toBe(true);
    expect(v.reason).toMatch(/flagged|read/i);
  });

  it("counts newly answered questions without treating them as proof", () => {
    const v = verdict(report([c(), c({ gained: true, documents: { found: 0, top: 0, text: "" } })]));
    expect(v.reason).toMatch(/1 newly answered/);
  });
});
