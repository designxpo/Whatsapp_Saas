// Reading the course off our own tracked links.
//
// LeadSquared does not hold one: 0 of the 1,000 most recent leads on Not
// Reachable had a usable mx_Course_Interested, and 254 held the literal "66".
// Our links already say it — ppc-wa-da-delhi is Data Analytics in Delhi — and
// the webhook already stores that label on the contact.
//
// The dangerous direction is the generous one. Day 12 carries "₹6 lakh
// minimum CTC, 50% fee refund"; addressing somebody by a course they never
// asked about is worse than not addressing them at all. So every label that
// does NOT state a course is asserted to return null, by name, against the
// real list from production.
import { describe, it, expect } from "vitest";
import { courseFromLabel, programmeFor, ROLE_COURSE_VALUES } from "../leadtokens";

describe("labels that name a course", () => {
  it("reads Data Analytics out of every city variant", () => {
    for (const l of ["ppc-wa-da-delhi", "ppc-wa-da-noida", "ppc-wa-da-gurgaon", "ppc-wa-da-bangalore"]) {
      expect(courseFromLabel(l), l).toBe("Adv. Cert. in Data Analytics & AI");
    }
  });

  it("reads Data Science out of every city variant", () => {
    for (const l of ["ppc-wa-ds-delhi", "ppc-wa-ds-noida", "ppc-wa-ds-gurgaon", "ppc-wa-ds-bangalore"]) {
      expect(courseFromLabel(l), l).toBe("Adv. Cert. in Data Science & GenAI");
    }
  });

  it("treats ds-specialization as Data Science — the variant, not a subject", () => {
    expect(courseFromLabel("ppc-wa-ds-specialization")).toBe("Adv. Cert. in Data Science & GenAI");
  });

  it("reads the spelled-out forms too", () => {
    expect(courseFromLabel("ppc-data-science-delhi")).toBe("Adv. Cert. in Data Science & GenAI");
    expect(courseFromLabel("ppc_full_stack_ai")).toBe("Full Stack AI");
  });

  it("is case-insensitive", () => {
    expect(courseFromLabel("PPC-WA-DA-DELHI")).toBe("Adv. Cert. in Data Analytics & AI");
  });
});

describe("labels that do NOT name a course return null", () => {
  // The real list from production, 14 Oct. Every one of these is a place, an
  // action or a channel — none states a subject.
  it("refuses every non-course label we actually have", () => {
    for (const l of [
      "Brochures - Whatsapp", "Callback", "Classroom", "Email Templates - Whatsapp",
      "GMB_Whatsapp_Bangalore", "GMB_Whatsapp_Gurgaon", "GMB_Whatsapp_Noida",
      "Masterclass", "organic-whatsapp", "ppc-wa-courses", "ppc-wa-placement",
    ]) {
      expect(courseFromLabel(l), l).toBeNull();
    }
  });

  it("refuses nothing at all", () => {
    for (const l of ["", "   ", null, undefined]) expect(courseFromLabel(l)).toBeNull();
  });

  it("does not match a two-letter code buried inside a word", () => {
    // "da" inside "update" or "ds" inside "goods" must not claim a lead.
    expect(courseFromLabel("ppc-wa-update-offer")).toBeNull();
    expect(courseFromLabel("ppc-wa-goods")).toBeNull();
  });
});

describe("whatever it returns has to work downstream", () => {
  it("only ever returns a spelling the programme table knows", () => {
    for (const l of ["ppc-wa-da-delhi", "ppc-wa-ds-noida", "ppc_full_stack_ai", "ppc-wa-ba-delhi"]) {
      const c = courseFromLabel(l);
      if (c) expect(programmeFor(c), `${l} -> ${c}`).toBeTruthy();
    }
  });

  it("returns a value that actually passes the day-7 audience", () => {
    // The whole point: a derived course must unlock the gated steps, not sit
    // on the contact looking plausible.
    const c = courseFromLabel("ppc-wa-ds-delhi")!;
    expect(ROLE_COURSE_VALUES).toContain(c);
  });
});
