// The names LeadSquared actually holds.
//
// Measured 14 Oct against all 4,033 leads on "Not Reachable": 1,072 name a
// course and NONE of them used a spelling this table knew. LeadSquared speaks
// the website catalogue — "Data Science 360 Course" — while the table spoke
// the sales deck — "Adv. Cert. in Data Science & GenAI". The overlap was zero,
// so days 7, 12 and 18 reached nobody and the field looked like junk data.
//
// These are the real values with their real counts. They are pinned here
// because the next person to tidy this table will not have the CRM in front
// of them, and deleting a name that looks redundant silently un-sends three
// messages to several hundred people.
import { describe, it, expect } from "vitest";
import { programmeFor, PROGRAMMES, CTC_COURSE_VALUES, ROLE_COURSE_VALUES, CLASSROOM_COURSE_VALUES } from "../leadtokens";
import { coursePicks, needsCourse } from "../coursepick";

/** Every value held by 2+ leads on "Not Reachable", 14 Oct 2026. */
const LIVE: [string, number][] = [
  ["Data Science 360 Course", 302], ["Business Analytics 360", 149],
  ["Data Science With Python", 111], ["Data Science Course", 111],
  ["Data Visualization & Analytics", 105], ["Certified Big Data Engineer", 56],
  ["Cyber Security", 49], ["Full Stack Applied AI Course", 39],
  ["Analytics Edge", 36], ["Machine Learning Course", 29],
  ["Data Science using R", 27], ["Artificial Intelligence Engineering", 25],
  ["Deep Learning With Python", 12], ["Python Machine Learning Course", 8],
  ["Business Analytics Course", 6], ["Generative AI", 2],
];

const held = (n: number) => LIVE.filter(([c]) => programmeFor(c)).reduce((s, [, k]) => s + k, 0) && n;

describe("every course LeadSquared holds is recognised", () => {
  for (const [course, n] of LIVE) {
    it(`"${course}" (${n} leads)`, () => {
      expect(programmeFor(course), course).toBeTruthy();
    });
  }
});

describe("the salary claim stays where it is published", () => {
  // AnalytixLabs publishes a guaranteed minimum CTC for one track — its
  // placements page names "Advanced Certification in Data Science | Full
  // Stack Applied AI" at ₹6,00,000 — and says other courses do not carry it.
  const ctc = new Set(CTC_COURSE_VALUES.map(v => v.toLowerCase()));

  it("reaches the guaranteed track", () => {
    for (const c of ["Data Science 360 Course", "Data Science Course", "Full Stack Applied AI Course"]) {
      expect(ctc.has(c.toLowerCase()), c).toBe(true);
    }
  });

  it("reaches every technical track, under whatever name the CRM uses", () => {
    // Tanvi, 14 Oct: Data Science keeps ₹6,00,000 — the rename to "with
    // GenAI" changed the name and not the figure. Every other technical
    // programme in the table was already on ₹6 lakh. So the variants are
    // not a separate question: a lead who wrote "Data Science using R" is
    // on the same programme as one who wrote "Data Science 360 Course".
    for (const c of ["Analytics Edge", "Data Science With Python", "Data Science using R",
                     "Machine Learning Course", "Deep Learning With Python",
                     "Python Machine Learning Course", "Data Visualization & Analytics",
                     "Certified Big Data Engineer", "Artificial Intelligence Engineering"]) {
      expect(ctc.has(c.toLowerCase()), c).toBe(true);
    }
  });

  it("does NOT reach Business Analytics under any spelling", () => {
    // Tanvi, 14 Oct: "We don't offer any minimum CTC for Business Analytics
    // — the program doesn't include any job guarantee." The spellings are
    // the point: a figure must not leak in through a legacy name.
    for (const c of ["Business Analytics 360", "Business Analytics Course", "Certified Business Analytics"]) {
      expect(ctc.has(c.toLowerCase()), c).toBe(false);
    }
  });

  it("does NOT reach Cyber Security, which has no figure anywhere", () => {
    // The one track nothing establishes a role pair or a CTC for. 49 leads
    // keep days 3 and 28 and are sent no claim we cannot stand behind.
    expect(ctc.has("cyber security")).toBe(false);
  });
});

describe("the roles message, which only describes", () => {
  const roles = new Set(ROLE_COURSE_VALUES.map(v => v.toLowerCase()));

  it("reaches the modules too — naming a role is not a promise", () => {
    for (const c of ["Analytics Edge", "Data Science With Python", "Certified Big Data Engineer",
                     "Data Visualization & Analytics", "Artificial Intelligence Engineering"]) {
      expect(roles.has(c.toLowerCase()), c).toBe(true);
    }
  });

  it("skips Cyber Security, where no pair is published", () => {
    expect(roles.has("cyber security")).toBe(false);
  });

  it("gives the Executive intake its own pair, not the fresher one", () => {
    // Tanvi, 14 Oct: Data Scientist and Data Architect.
    const exec = programmeFor("Executive Data Science & AI");
    expect(exec?.roles).toEqual({ role1: "Data Scientist", role2: "Data Architect" });
    expect(exec?.minCtc).toBe("₹10 lakh");
  });

  it("every programme offering roles actually has two", () => {
    for (const p of PROGRAMMES) {
      if (!p.roles) continue;
      expect(p.roles.role1.trim(), p.display).toBeTruthy();
      expect(p.roles.role2.trim(), p.display).toBeTruthy();
      expect(p.roles.role1).not.toBe(p.roles.role2);
    }
  });
});

describe("the centre invitation", () => {
  const classroom = new Set(CLASSROOM_COURSE_VALUES.map(v => v.toLowerCase()));
  it("reaches the courses taught at a centre", () => {
    for (const c of ["Data Science 360 Course", "Business Analytics 360", "Certified Big Data Engineer"]) {
      expect(classroom.has(c.toLowerCase()), c).toBe(true);
    }
  });
  it("skips the online-only tracks", () => {
    for (const c of ["Full Stack Applied AI Course", "Artificial Intelligence Engineering"]) {
      expect(classroom.has(c.toLowerCase()), c).toBe(false);
    }
  });
});

describe("what we ask a lead", () => {
  it("offers only today's catalogue", () => {
    // Recognising "Data Science 360 Course" when the CRM says it is one
    // thing; offering it to a lead as a choice alongside its current name
    // would be asking them to pick between two names for one course.
    const titles = coursePicks().map(p => p.title.toLowerCase());
    for (const legacy of ["data science 360", "analytics edge", "business analytics 360"]) {
      expect(titles.some(t => t.includes(legacy)), legacy).toBe(false);
    }
  });

  it("still offers something", () => {
    expect(coursePicks().length).toBeGreaterThanOrEqual(5);
  });

  it("no longer asks a lead whose course we now understand", () => {
    // These leads were being asked a question whose answer was already in
    // the CRM, and the picker does not even list their course.
    expect(needsCourse({ "Product Name": "Data Science 360 Course" })).toBe(false);
    expect(needsCourse({ "Product Name": "Cyber Security" })).toBe(false);
    expect(needsCourse({ "Product Name": "66" })).toBe(true);
  });
});

void held;
