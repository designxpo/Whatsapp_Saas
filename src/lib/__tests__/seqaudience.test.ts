// Who a drip step is for.
//
// The three real rules from the RNR brief are built here as the brief states
// them, not as the implementation expresses them, so a change of mind in the
// code cannot quietly agree with itself:
//
//   R+5   masterclass     only leads not already registered
//   R+10  results         only programmes that carry those terms
//   R+15  centre visit    only Bangalore/NCR, never the online-only courses
import { describe, it, expect } from "vitest";
import {
  matchesAudience, parseAudience, isEveryone, describeAudience, resolveStepAudiences, audienceFingerprint,

  type AudienceRule, type AudienceSubject,
} from "@/lib/seqaudience";

const lead = (attributes: Record<string, string> = {}, tags: string[] = []) => ({ attributes, tags });

describe("no rule means everyone", () => {
  it("null, undefined and {} all match anybody", () => {
    for (const r of [null, undefined, {} as AudienceRule]) {
      expect(matchesAudience(r, lead({ course: "anything" }))).toBe(true);
      expect(matchesAudience(r, lead())).toBe(true);
      expect(matchesAudience(r, null)).toBe(true);
    }
  });

  it("isEveryone agrees, including for a rule whose lists are empty", () => {
    expect(isEveryone(null)).toBe(true);
    expect(isEveryone({ attrIn: {}, hasTag: [] })).toBe(true);
    expect(isEveryone({ hasTag: ["x"] })).toBe(false);
  });
});

describe("R+10 — a claim we must be able to stand behind", () => {
  // "Only to leads on programmes that carry these terms." The message states
  // ₹6L minimum CTC and a 50% fee refund.
  const R10: AudienceRule = { attrIn: { course: ["Data Science", "Data Analytics"] } };

  it("goes to a lead on a listed programme", () => {
    expect(matchesAudience(R10, lead({ course: "Data Science" }))).toBe(true);
  });

  it("does NOT go to a lead on another programme", () => {
    expect(matchesAudience(R10, lead({ course: "AI for Managers" }))).toBe(false);
  });

  it("does NOT go to a lead whose course we do not know", () => {
    // The whole point. An incomplete CRM record must not be read as consent
    // to make a salary and refund claim — unknown is not yes.
    expect(matchesAudience(R10, lead({}))).toBe(false);
    expect(matchesAudience(R10, null)).toBe(false);
  });

  it("does NOT treat an empty attribute value as a match", () => {
    expect(matchesAudience(R10, lead({ course: "" }))).toBe(false);
    expect(matchesAudience(R10, lead({ course: "   " }))).toBe(false);
  });

  it("matches regardless of case and padding, on both key and value", () => {
    // CRM exports disagree about capitalisation constantly. A rule that
    // silently matched nobody would look exactly like one correctly
    // excluding everybody.
    expect(matchesAudience(R10, lead({ Course: " data science " }))).toBe(true);
    expect(matchesAudience(R10, lead({ COURSE: "DATA ANALYTICS" }))).toBe(true);
  });
});

describe("R+15 — centre visit", () => {
  // Bangalore and NCR only, and never the online-only courses.
  const R15: AudienceRule = {
    attrIn: { city: ["Bangalore", "Noida", "Gurgaon", "Delhi"] },
    attrNotIn: { course: ["Full Stack AI", "GenAI", "Agentic AI"] },
  };

  it("goes to a classroom course in a centre city", () => {
    expect(matchesAudience(R15, lead({ city: "Noida", course: "Data Science" }))).toBe(true);
  });

  it("does not go to an online-only course, even in a centre city", () => {
    expect(matchesAudience(R15, lead({ city: "Bangalore", course: "GenAI" }))).toBe(false);
  });

  it("does not go to another city", () => {
    expect(matchesAudience(R15, lead({ city: "Pune", course: "Data Science" }))).toBe(false);
  });

  it("an unknown CITY keeps them out — attrIn must be satisfied", () => {
    expect(matchesAudience(R15, lead({ course: "Data Science" }))).toBe(false);
  });

  it("an unknown COURSE alone does not keep them out — attrNotIn excludes only the known-bad", () => {
    // The asymmetry, stated as a test. attrNotIn is an exclusion list; a
    // value we do not have is not on it. The city clause is what actually
    // guards this step, which is why it is there.
    expect(matchesAudience(R15, lead({ city: "Gurgaon" }))).toBe(true);
  });
});

describe("R+5 — not already registered", () => {
  const R5: AudienceRule = { lacksTag: ["masterclass-registered"] };

  it("goes to a lead with no tags at all", () => {
    expect(matchesAudience(R5, lead({}, []))).toBe(true);
    expect(matchesAudience(R5, { attributes: {}, tags: null })).toBe(true);
  });

  it("is withheld from a lead already registered", () => {
    expect(matchesAudience(R5, lead({}, ["masterclass-registered"]))).toBe(false);
  });

  it("ignores tag case", () => {
    expect(matchesAudience(R5, lead({}, ["Masterclass-Registered"]))).toBe(false);
  });

  it("hasTag requires EVERY tag, not any", () => {
    const r: AudienceRule = { hasTag: ["paid", "verified"] };
    expect(matchesAudience(r, lead({}, ["paid"]))).toBe(false);
    expect(matchesAudience(r, lead({}, ["paid", "verified"]))).toBe(true);
  });
});

describe("every clause must pass", () => {
  it("one failing clause fails the whole rule", () => {
    const r: AudienceRule = { attrIn: { city: ["Noida"] }, lacksTag: ["registered"] };
    expect(matchesAudience(r, lead({ city: "Noida" }, []))).toBe(true);
    expect(matchesAudience(r, lead({ city: "Noida" }, ["registered"]))).toBe(false);
    expect(matchesAudience(r, lead({ city: "Pune" }, []))).toBe(false);
  });

  it("an empty value list constrains nothing rather than excluding everybody", () => {
    expect(matchesAudience({ attrIn: { course: [] } }, lead({}))).toBe(true);
    expect(matchesAudience({ attrNotIn: { course: [] } }, lead({ course: "x" }))).toBe(true);
  });
});

describe("parseAudience — garbage widens, never narrows", () => {
  it("reads a well-formed rule", () => {
    const r = parseAudience({ attrIn: { course: ["Data Science"] }, lacksTag: ["registered"] });
    expect(r?.attrIn?.course).toEqual(["Data Science"]);
    expect(r?.lacksTag).toEqual(["registered"]);
  });

  it("a single string is accepted where a list is expected", () => {
    // Hand-written JSON does this constantly.
    expect(parseAudience({ attrIn: { course: "Data Science" } })?.attrIn?.course).toEqual(["Data Science"]);
    expect(parseAudience({ lacksTag: "registered" })?.lacksTag).toEqual(["registered"]);
  });

  it("nonsense becomes null — everyone — not an unmatchable rule", () => {
    // A garbled rule that matched NOBODY would skip every lead while the
    // enrolment kept advancing, so the journey would complete having sent
    // nothing and looking complete. Too many is visible; nobody is not.
    for (const junk of [null, undefined, 42, "rule", [], { attrIn: 7 }, { hasTag: [123] }]) {
      expect(parseAudience(junk)).toBeNull();
    }
  });

  it("drops empty strings rather than matching on them", () => {
    expect(parseAudience({ hasTag: ["", "  "] })).toBeNull();
  });
});

describe("describeAudience — readable by the person who has to explain it", () => {
  it("says 'everyone' when there is no rule", () => {
    expect(describeAudience(null)).toBe("Everyone in this journey");
  });

  it("names the attribute and the values", () => {
    const d = describeAudience({ attrIn: { course: ["Data Science"] }, lacksTag: ["registered"] });
    expect(d).toContain("course is Data Science");
    expect(d).toContain("not tagged registered");
  });
});

describe("resolveStepAudiences — a save must not widen a restricted step", () => {
  const R = { lacksTag: ["masterclass-registered"] };
  const C = { attrIn: { city: ["Noida"] } };

  it("keeps the stored rule when the client did not mention audience", () => {
    // A browser tab opened before 0103 shipped sends steps with no audience
    // key at all. Dropping the rules would send R+5, R+10 and R+15 to every
    // enrolled lead, silently, from the next drain onwards.
    const out = resolveStepAudiences([{ delayMinutes: 0 }, { delayMinutes: 1 }], [R, C]);
    expect(out).toEqual([R, C]);
  });

  it("an explicit null CLEARS the rule — that is a different answer", () => {
    const out = resolveStepAudiences([{ delayMinutes: 0, audience: null }], [R]);
    expect(out).toEqual([null]);
  });

  it("an explicit rule replaces the stored one", () => {
    const out = resolveStepAudiences([{ delayMinutes: 0, audience: C }], [R]);
    expect(out[0]?.attrIn?.city).toEqual(["Noida"]);
  });

  it("a step beyond what was stored gets no rule rather than throwing", () => {
    expect(resolveStepAudiences([{}, {}, {}], [R])).toEqual([R, null, null]);
  });

  it("nothing stored and nothing sent is nothing", () => {
    expect(resolveStepAudiences([{}, {}], [])).toEqual([null, null]);
  });

  it("undefined stored reads as no rule, not as a hole", () => {
    expect(resolveStepAudiences([{}, {}], [undefined, R])).toEqual([null, R]);
  });

  it("garbage sent for audience becomes 'everyone', never an unmatchable rule", () => {
    expect(resolveStepAudiences([{ audience: "nonsense" }], [R])).toEqual([null]);
  });
});

// Deciding whether two audience rules are the SAME rule.
//
// This is what the health check and the rebuild panel both ask before saying
// a step is running an older course list. It has to agree with the matcher:
// a fingerprint that differs where matchesAudience does not would report
// drift forever, and one that matches where matchesAudience differs would
// stay quiet while a step reached the wrong people.
describe("audienceFingerprint", () => {
  it("ignores the order of values", () => {
    // Reordering PROGRAMMES changes every generated list and not one lead.
    expect(audienceFingerprint({ attrIn: { course: ["a", "b"] } }))
      .toBe(audienceFingerprint({ attrIn: { course: ["b", "a"] } }));
  });

  it("ignores the order of keys", () => {
    expect(audienceFingerprint({ attrIn: { course: ["a"], city: ["x"] } }))
      .toBe(audienceFingerprint({ attrIn: { city: ["x"], course: ["a"] } }));
  });

  it("ignores casing and padding, exactly as the matcher does", () => {
    expect(audienceFingerprint({ attrIn: { Course: [" A "] } }))
      .toBe(audienceFingerprint({ attrIn: { course: ["a"] } }));
  });

  it("treats no rule and an empty rule as one thing", () => {
    // matchesAudience already does — both match everyone.
    expect(audienceFingerprint(null)).toBe(audienceFingerprint({}));
    expect(audienceFingerprint(undefined)).toBe(audienceFingerprint({ attrIn: {} }));
  });

  it("separates a rule from no rule", () => {
    // The 0103 failure: the audience silently dropped, so a step carrying a
    // salary claim went to everybody.
    expect(audienceFingerprint({ attrIn: { course: ["a"] } })).not.toBe(audienceFingerprint(null));
  });

  it("notices a value added or removed", () => {
    const one = audienceFingerprint({ attrIn: { course: ["a"] } });
    expect(audienceFingerprint({ attrIn: { course: ["a", "b"] } })).not.toBe(one);
    expect(audienceFingerprint({ attrIn: { course: [] } })).not.toBe(one);
  });

  it("notices attrIn and attrNotIn swapping places", () => {
    // Same values, opposite meaning.
    expect(audienceFingerprint({ attrIn: { course: ["a"] } }))
      .not.toBe(audienceFingerprint({ attrNotIn: { course: ["a"] } }));
  });

  it("agrees with the matcher on every pair it calls identical", () => {
    // The property that matters: equal fingerprints must select equally.
    const rules: (AudienceRule | null)[] = [
      null, {}, { attrIn: { course: ["a", "b"] } }, { attrIn: { course: ["b", " A "] } },
      { attrNotIn: { course: ["a"] } }, { hasTag: ["x"] }, { lacksTag: ["x"] },
      { attrIn: { course: ["a"] }, hasTag: ["x"] },
    ];
    const subjects: AudienceSubject[] = [
      { attributes: { course: "a" } }, { attributes: { course: "b" } },
      { attributes: {} }, { attributes: { course: "a" }, tags: ["x"] }, { tags: ["x"] },
    ];
    for (const p of rules) for (const q of rules) {
      if (audienceFingerprint(p) !== audienceFingerprint(q)) continue;
      for (const s of subjects) {
        expect(matchesAudience(p, s), `${JSON.stringify(p)} vs ${JSON.stringify(q)}`)
          .toBe(matchesAudience(q, s));
      }
    }
  });
});

// Saying a rule out loud, at the size the rule actually is.
//
// The course lists went from 12 names to 40 when the legacy catalogue was
// mapped. Spelled out, each step rendered as a paragraph and the DAY — the
// one thing the row exists to show — was lost in it.
describe("describeSeqAudience at scale", () => {
  const forty = Array.from({ length: 40 }, (_, i) => `Course ${i + 1}`);

  it("summarises a long list rather than printing it", () => {
    const text = describeAudience({ attrIn: { "Product Name": forty } });
    expect(text).toBe("Product Name is one of 40 values");
    expect(text).not.toContain("Course 7");
  });

  it("still spells out a short one, where the names ARE the information", () => {
    const text = describeAudience({ attrIn: { city: ["noida", "gurgaon"] } });
    expect(text).toBe("city is noida or gurgaon");
  });

  it("spells everything out when asked, for the hover", () => {
    const text = describeAudience({ attrIn: { "Product Name": forty } }, true);
    expect(text).toContain("Course 1");
    expect(text).toContain("Course 40");
  });

  it("summarises each clause on its own merits", () => {
    // The centre step is a long course list AND a short city list. Collapsing
    // both would hide the cities, which are the half a reader can act on.
    const text = describeAudience({ attrIn: { city: ["noida", "delhi"], "Product Name": forty } });
    expect(text).toContain("city is noida or delhi");
    expect(text).toContain("one of 40 values");
  });
});
