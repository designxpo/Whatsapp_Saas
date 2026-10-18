// Asking the lead which programme they are on.
//
// Three of the five drip steps are addressed by the course, and measured on
// 14 Oct none of the 1,000 most recent leads on "Not Reachable" had a usable
// one — 254 held the literal "66". The tracked link rescues the paid traffic;
// for everybody else the only remaining source of truth is the person.
//
// The thing that must not break is the ROUND TRIP. A list reply arrives as
// the row's TITLE, not its id, so a label that drifts from the programme
// table is an answer the lead gave us and we silently threw away.
import { describe, it, expect } from "vitest";
import {
  coursePicks, matchCoursePick, needsCourse, ROW_TITLE_MAX, MAX_ROWS,
} from "../coursepick";
import { programmeFor, ROLE_COURSE_VALUES } from "../leadtokens";

describe("the options offered", () => {
  it("fit WhatsApp's limits", () => {
    const picks = coursePicks();
    expect(picks.length).toBeGreaterThan(0);
    expect(picks.length).toBeLessThanOrEqual(MAX_ROWS);
    for (const p of picks) expect(p.title.length, p.title).toBeLessThanOrEqual(ROW_TITLE_MAX);
  });

  it("every option resolves to a real programme", () => {
    // A row storing a value the table does not know would pass the audience
    // gate and then render a message with a blank in it.
    for (const p of coursePicks()) expect(programmeFor(p.crmName), p.title).toBeTruthy();
  });

  it("offers only programmes that unlock a message", () => {
    // AI for Managers has neither roles nor a CTC: picking it would answer
    // the question and still receive nothing, which teaches the lead the
    // question was pointless.
    expect(coursePicks().some(p => /managers/i.test(p.title))).toBe(false);
  });

  it("offers no two options the lead cannot tell apart", () => {
    const titles = coursePicks().map(p => p.title.toLowerCase());
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("shortens a long name on a word boundary", () => {
    // "Executive Data Science & AI" is 27 characters. Cut mid-word it reads
    // as a typo; cut at a space it is still the thing they signed up for.
    const exec = coursePicks().find(p => /executive/i.test(p.title));
    expect(exec).toBeTruthy();
    expect(exec!.title).toBe("Executive Data Science");
  });
});

describe("the round trip — what they tap must come back", () => {
  it("every option matches itself", () => {
    for (const p of coursePicks()) expect(matchCoursePick(p.title), p.title).toBe(p.crmName);
  });

  it("every answer unlocks the gated steps", () => {
    // The whole point. An answer that does not pass the audience is an
    // answer that changed nothing.
    for (const p of coursePicks()) {
      expect(ROLE_COURSE_VALUES, p.title).toContain(p.crmName);
    }
  });

  it("survives casing and punctuation", () => {
    expect(matchCoursePick("DATA ANALYTICS")).toBe("Adv. Cert. in Data Analytics & AI");
    expect(matchCoursePick("  data analytics  ")).toBe("Adv. Cert. in Data Analytics & AI");
  });

  it("accepts a lead who TYPED a course instead of tapping", () => {
    expect(matchCoursePick("Full Stack AI")).toBe("Full Stack AI");
    expect(matchCoursePick("Adv. Cert. in Data Science & GenAI")).toBe("Adv. Cert. in Data Science & GenAI");
  });

  it("matches nothing on ordinary conversation", () => {
    // This runs against every inbound message; a false positive would
    // overwrite somebody's real course with a word from a sentence.
    for (const t of ["Yes, call me now", "hi", "what is the fee", "ok", "", "Close my enquiry"]) {
      expect(matchCoursePick(t), t).toBeNull();
    }
  });
});

describe("who gets asked", () => {
  it("asks when we hold nothing", () => {
    expect(needsCourse({})).toBe(true);
    expect(needsCourse(null)).toBe(true);
    expect(needsCourse({ "Product Name": "   " })).toBe(true);
  });

  it("asks when what we hold is junk — the commonest live case", () => {
    for (const junk of ["66", "-", "Select", "0"]) {
      expect(needsCourse({ "Product Name": junk }), junk).toBe(true);
    }
  });

  it("does NOT ask when we already know", () => {
    // Asking a question we can answer ourselves turns a helpful prompt into
    // an irritation — and the held value may be one the lead gave us.
    expect(needsCourse({ "Product Name": "Adv. Cert. in Data Analytics & AI" })).toBe(false);
    expect(needsCourse({ "Product Name": "Full Stack AI" })).toBe(false);
  });
});
