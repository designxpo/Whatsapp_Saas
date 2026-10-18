// What fills {{1}} for this lead.
//
// The lookup tables are transcribed from the message library's own tables
// (sections 3). The tests that matter most are the two that tie an AUDIENCE
// list to the TABLE it gates: a lead who passes the audience but has no
// value in the table receives a template with a blank in it, or none at all,
// and neither failure says why.
import { describe, it, expect } from "vitest";
import {
  leadTokens, missingTokens, firstName, normCourse, programmeFor,
  PROGRAMMES, CENTRES, CITY_CENTRE,
  CTC_COURSE_VALUES, ROLE_COURSE_VALUES, CLASSROOM_COURSE_VALUES, CENTRE_CITIES,
} from "@/lib/leadtokens";

const lead = (attributes: Record<string, string>, name = "Rahul Sharma") => ({ name, attributes });

describe("the table is keyed on what LeadSquared actually holds", () => {
  // Read off the live contacts. A table keyed on the message library's own
  // wording matched none of these, so the three restricted steps would have
  // been skipped for every lead while the journey reported itself complete.
  const LIVE = [
    "Adv. Cert. in Data Analytics & AI",
    "Adv. Cert. in Data Science & AI",
    "Adv. Cert. in Data Science & GenAI",
    "Executive Certif. in Data Science with AI Spec & GenAI",
    "Certified Business Analytics",
  ];

  it("recognises every Product Name in the live data", () => {
    for (const v of LIVE) expect(programmeFor(v), `${v} is not in the table`).toBeTruthy();
  });

  it("gives each one a name a sentence can use", () => {
    // "our Adv. Cert. in Data Analytics & AI course prepares you" is not a
    // sentence anybody would send.
    expect(leadTokens({ name: "R", attributes: { "Product Name": LIVE[0] } }).course).toBe("Data Analytics");
    expect(leadTokens({ name: "R", attributes: { "Product Name": LIVE[3] } }).course).toBe("Executive Data Science & AI");
  });

  it("reads the library's full wording too, for a different export", () => {
    expect(programmeFor("Advanced Certification in Data Analytics with AI")?.display).toBe("Data Analytics");
    // Renamed. Tanvi, 14 Oct: "Advanced Certification in Data Science has
    // been renamed to Advanced Certification in Data Science with GenAI."
    // The OLD spelling must keep resolving — the leads already filed under
    // it were not renamed with the course.
    expect(programmeFor("Data Science")?.display).toBe("Data Science with GenAI");
    expect(programmeFor("Adv. Cert. in Data Science & GenAI")?.display).toBe("Data Science with GenAI");
  });
});

describe("the audience lists are generated from the table, so they cannot drift", () => {
  it("every course allowed through R+10 has a min_ctc", () => {
    for (const c of CTC_COURSE_VALUES) {
      expect(programmeFor(c)?.minCtc, `${c} passes R+10's audience but has no figure`).toBeTruthy();
    }
  });

  it("every course allowed through R+2 has a role pair", () => {
    for (const c of ROLE_COURSE_VALUES) {
      expect(programmeFor(c)?.roles, `${c} passes R+2's audience but has no roles`).toBeTruthy();
    }
  });

  it("every classroom course has a display name R+15 can print", () => {
    for (const c of CLASSROOM_COURSE_VALUES) expect(programmeFor(c)?.display).toBeTruthy();
  });

  it("every centre city maps to a real centre", () => {
    for (const c of CENTRE_CITIES) {
      const key = CITY_CENTRE[normCourse(c)];
      expect(key, `${c} passes R+15's audience but maps to no centre`).toBeTruthy();
      expect(CENTRES[key]).toBeTruthy();
    }
  });

  it("'Executive Data Science & AI' resolves — the ampersand case", () => {
    // The spelling that breaks if the two normalisers drift: an audience
    // keeps the "&", the table key does not.
    expect(programmeFor("Executive Data Science & AI")?.minCtc).toBe("₹10 lakh");
    expect(programmeFor("Executive Certif. in Data Science with AI Spec & GenAI")?.minCtc).toBe("₹10 lakh");
  });

  it("AI for Managers has no roles, so it cannot pass R+2", () => {
    expect(programmeFor("AI for Managers")?.roles).toBeUndefined();
    expect(ROLE_COURSE_VALUES).not.toContain("AI for Managers");
  });

  it("courses without the terms carry no figure and cannot pass R+10", () => {
    for (const c of ["GenAI", "Agentic AI", "Business Analytics", "Certified Business Analytics", "AI for Managers"]) {
      expect(programmeFor(c)?.minCtc, `${c} must not carry a CTC figure`).toBeUndefined();
      expect(CTC_COURSE_VALUES).not.toContain(c);
    }
  });

  it("Data Science with GenAI carries the CTC, under BOTH its names", () => {
    // Was held out of R+10 pending an answer, because promising a refund
    // nobody had checked is the one failure here with a legal edge. Tanvi
    // answered on 14 Oct: it is the renamed Data Science course and "hence
    // it remains INR 6,00,000".
    //
    // Both spellings are asserted because both are live in the CRM — a
    // rename does not rewrite the leads already filed under the old name,
    // and a lead on one spelling getting the message while a lead on the
    // other does not would be the same course treated two ways.
    for (const n of ["Adv. Cert. in Data Science & GenAI", "Adv. Cert. in Data Science & AI", "Data Science"]) {
      expect(programmeFor(n)?.minCtc, n).toBe("₹6 lakh");
      expect(CTC_COURSE_VALUES, n).toContain(n);
      expect(programmeFor(n)?.roles, n).toBeTruthy();
    }
  });

  it("the Executive programme now has its role pair", () => {
    // Held out of R+2 while nobody could say whether an executive intake
    // changes role at all. Tanvi, 14 Oct: Data Scientist and Data Architect.
    expect(programmeFor("Executive Data Science & AI")?.roles).toEqual({
      role1: "Data Scientist", role2: "Data Architect",
    });
    expect(ROLE_COURSE_VALUES).toContain("Executive Data Science & AI");
  });

  it("Business Analytics still carries NO figure, and now on the record", () => {
    // Tanvi, 14 Oct: "We don't offer any minimum CTC for Business Analytics
    // — the program doesn't include any job guarantee." Previously inferred
    // from the library's silence; now confirmed, so it must not acquire one
    // later on the grounds that every other programme has one.
    for (const n of ["Certified Business Analytics", "Business Analytics"]) {
      expect(programmeFor(n)?.minCtc, n).toBeUndefined();
      expect(CTC_COURSE_VALUES, n).not.toContain(n);
      expect(programmeFor(n)?.roles, n).toBeTruthy();   // R+2 is still fine
    }
  });

  it("every open question is recorded rather than guessed at", () => {
    const open = PROGRAMMES.filter(p => p.open);
    expect(open.length).toBeGreaterThan(0);
    for (const p of open) expect(p.open).toMatch(/\S/);
  });
});

describe("firstName", () => {
  it("takes the first word", () => {
    expect(firstName("Rahul Sharma")).toBe("Rahul");
  });

  it("tidies shouting and sloppiness", () => {
    expect(firstName("RAHUL SHARMA")).toBe("Rahul");
    expect(firstName("rahul")).toBe("Rahul");
    expect(firstName("  Rahul  ")).toBe("Rahul");
  });

  it("keeps names that are not plain ASCII", () => {
    expect(firstName("José García")).toBe("José");
    expect(firstName("प्रिया शर्मा")).toBe("प्रिया");
  });

  it("keeps a hyphen or apostrophe", () => {
    expect(firstName("Anne-Marie Dubois")).toBe("Anne-marie");
    expect(firstName("O'Brien")).toBe("O'brien");
  });

  it("returns nothing for a phone number — 'Hi 9876543210' is worse than silence", () => {
    expect(firstName("9876543210")).toBe("");
    expect(firstName("+91 98765 43210")).toBe("");
  });

  it("returns nothing for nothing", () => {
    expect(firstName("")).toBe("");
    expect(firstName(null)).toBe("");
    expect(firstName(undefined)).toBe("");
  });
});

describe("leadTokens", () => {
  it("derives the roles from the course", () => {
    const t = leadTokens(lead({ "Product Name": "Data Science" }));
    expect(t.role_1).toBe("Data Scientist");
    expect(t.role_2).toBe("Machine Learning Engineer");
  });

  it("derives the CTC from the course", () => {
    expect(leadTokens(lead({ "Product Name": "Full Stack AI" })).min_ctc).toBe("₹6 lakh");
    expect(leadTokens(lead({ "Product Name": "Executive Data Science & AI" })).min_ctc).toBe("₹10 lakh");
  });

  it("reads the city spellings that are actually in the data", () => {
    // Live values include trailing spaces on most rows and "Banglore"
    // (missing the second 'a') on three. Each one that fails to match is a
    // lead who silently never gets the centre invitation.
    for (const [city, centre] of [
      ["Banglore ", "Bangalore"], ["Bengaluru ", "Bangalore"], ["Bengalore", "Bangalore"],
      ["Delhi ", "Gurgaon"], ["Gurgaon ", "Gurgaon"], ["Noida ", "Noida"], ["delhi", "Gurgaon"],
    ]) {
      expect(leadTokens(lead({ city })).centre_name, `city "${city}"`).toBe(centre);
    }
  });

  it("derives the nearest centre from the city", () => {
    expect(leadTokens(lead({ city: "Bengaluru" })).centre_name).toBe("Bangalore");
    expect(leadTokens(lead({ city: "Gurugram" })).centre_name).toBe("Gurgaon");
    expect(leadTokens(lead({ city: "Ghaziabad" })).centre_name).toBe("Noida");
    expect(leadTokens(lead({ city: "Bengaluru" })).centre_address).toMatch(/HSR Layout/);
  });

  it("reads attributes whatever case the CRM used", () => {
    expect(leadTokens(lead({ course: "Data Science" })).role_1).toBe("Data Scientist");
    expect(leadTokens(lead({ CITY: "noida" })).centre_name).toBe("Noida");
  });

  it("passes plain attributes through, lowercased", () => {
    expect(leadTokens(lead({ Source: "Google Ads" })).source).toBe("Google Ads");
  });

  it("a derived value cannot be shadowed by an attribute of the same name", () => {
    // A stale CRM field called min_ctc must not outrank the table — that is
    // how an unverified figure reaches a lead.
    const t = leadTokens(lead({ "Product Name": "Data Science", min_ctc: "₹99 lakh" }));
    expect(t.min_ctc).toBe("₹6 lakh");
  });

  it("leaves a derived value empty when the course is unknown", () => {
    const t = leadTokens(lead({ "Product Name": "Underwater Basket Weaving" }));
    expect(t.role_1).toBe("");
    expect(t.min_ctc).toBe("");
  });

  it("survives a lead with nothing on it", () => {
    const t = leadTokens(null);
    expect(t.first_name).toBe("");
    expect(t.min_ctc).toBe("");
  });
});

describe("missingTokens — an empty variable must never be sent", () => {
  it("names the tokens that resolve to nothing", () => {
    const t = leadTokens(lead({}, ""));
    expect(missingTokens(["{first_name}"], t)).toEqual(["first_name"]);
  });

  it("is empty when everything resolves", () => {
    const t = leadTokens(lead({ "Product Name": "Data Science" }));
    expect(missingTokens(["{first_name}", "{course}", "{role_1}"], t)).toEqual([]);
  });

  it("counts whitespace as missing", () => {
    expect(missingTokens(["{course}"], { course: "   " })).toEqual(["course"]);
  });

  it("reports each token once, however often it appears", () => {
    expect(missingTokens(["{x}", "{x} and {x}"], {})).toEqual(["x"]);
  });

  it("ignores literal text", () => {
    expect(missingTokens(["Hello there"], {})).toEqual([]);
  });

  it("catches the R+10 case: passes the audience, no figure in the table", () => {
    // If the audience list and MIN_CTC ever drift, this is what stops the
    // lead receiving "• minimum CTC on your programme".
    const t = leadTokens(lead({ "Product Name": "Business Analytics" }));
    expect(missingTokens(["{min_ctc}"], t)).toEqual(["min_ctc"]);
  });
});
