// The RNR journey as the message library states it.
//
// Names, days, buttons and audiences below are transcribed from the RNR
// WhatsApp Message Library (30 September 2026), not read back out of
// rnrseed.ts, so a change nobody agreed to fails here rather than shipping.
import { describe, it, expect } from "vitest";
import {
  rnrTemplates, rnrSteps, heldSteps, buildSteps, validateButtons,
  templateDrafts, rnrSequenceSettings, MASTERCLASS_TAG, MAX_BUTTON_CHARS,
} from "@/lib/rnrseed";
import { matchTap } from "@/lib/rnrtaps";

const base = { channelId: "ch-ppc-sm" };
const all = rnrTemplates(base);
const byId = (id: string) => all.find(t => t.id === id)!;

describe("the library, transcribed", () => {
  it("has nine templates: two while calling, seven in the drip", () => {
    expect(all).toHaveLength(9);
    expect(all.filter(t => t.phase === "calling").map(t => t.id)).toEqual(["T1", "T2"]);
    expect(all.filter(t => t.phase === "drip").map(t => t.id)).toEqual(["T3", "T4", "T5", "T6", "T7", "T8", "T9"]);
  });

  it("names them exactly as the library does", () => {
    expect(all.map(t => t.templateName)).toEqual([
      "rnr_01_missed_call", "rnr_02_call_retry", "rnr_03_about_us", "rnr_04_course_roles",
      "rnr_05_masterclass", "rnr_06_results", "rnr_07_centre_visit", "rnr_08_next_batch",
      "rnr_09_keep_or_close",
    ]);
  });

  it("puts the drip on the days we send it, not the library's", () => {
    // The library asks for 1, 2, 5, 10, 15, 21, 28. Those put four MARKETING
    // templates on four consecutive days once the counsellor's two are
    // counted, and Meta's per-recipient cap (131049) drops the overflow
    // silently. Re-spaced deliberately — see the `day` comment in rnrseed.ts
    // and rnr-drip-spacing.test.ts, which holds the gaps apart.
    expect(all.filter(t => t.phase === "drip").map(t => t.day)).toEqual([3, 7, 10, 12, 18, 24, 28]);
  });

  it("keeps T1 and T2 out of the drip — a counsellor sends those personally", () => {
    expect(all.filter(t => t.phase === "calling").every(t => t.day === null)).toBe(true);
    expect(rnrSteps({ ...base, includeHeld: true }).some(t => t.phase === "calling")).toBe(false);
  });
});

describe("what is held back, and why", () => {
  it("T5 and T8 are on hold — neither has a data source", () => {
    expect(heldSteps(base).map(t => t.id)).toEqual(["T5", "T8"]);
    expect(byId("T5").hold).toMatch(/masterclass schedule/i);
    expect(byId("T8").hold).toMatch(/batch date/i);
  });

  it("a held step is LEFT OUT of the sequence, not sent with a blank", () => {
    // {{masterclass_date}} with nothing behind it is either a Meta rejection
    // or "on  at ." in front of a lead. Both are worse than not sending.
    expect(rnrSteps(base).map(t => t.id)).toEqual(["T3", "T4", "T6", "T7", "T9"]);
  });

  it("the five that remain are the ones the library calls ready", () => {
    expect(rnrSteps(base).every(t => t.hold === null)).toBe(true);
  });

  it("includeHeld puts them back, for a test rather than for leads", () => {
    expect(rnrSteps({ ...base, includeHeld: true })).toHaveLength(7);
  });
});

describe("the waits between steps", () => {
  it("converts the library's absolute days into waits", () => {
    const days = buildSteps(rnrSteps(base)).map(s => s.delayMinutes / (24 * 60));
    expect(days).toEqual([3, 4, 5, 6, 10]);           // 3, 7, 12, 18, 28
    expect(days.reduce((a, b) => a + b, 0)).toBe(28);
  });

  it("closes the gaps left by the held steps rather than pausing for them", () => {
    // With T5 and T8 out, R+6 must not sit idle waiting for a day that has
    // no message on it — R+10 lands on R+10 either way.
    const withHeld = buildSteps(rnrSteps({ ...base, includeHeld: true })).map(s => s.delayMinutes / (24 * 60));
    expect(withHeld).toEqual([3, 4, 3, 2, 6, 6, 4]);  // 3,7,10,12,18,24,28
    expect(withHeld.reduce((a, b) => a + b, 0)).toBe(28);
  });

  it("the first step waits three days, clear of the counsellor's second message", () => {
    // One day was the brief's number and it put the drip's opener the day
    // after Message B — two marketing templates back to back after two more.
    expect(buildSteps(rnrSteps(base))[0].delayMinutes).toBe(3 * 24 * 60);
  });
});

describe("every button routes somewhere", () => {
  it("each label in the library is one the router knows", () => {
    for (const t of all) {
      for (const b of t.buttons) {
        expect(matchTap(b), `${t.templateName}: "${b}" routes to nothing`).not.toBeNull();
      }
    }
  });

  it("the whole library passes validation", () => {
    expect(validateButtons(all)).toEqual([]);
  });

  it("'Check back in 2 weeks' is 21 characters and perfectly valid", () => {
    // An earlier pass here shortened this label believing the limit was 20.
    // Meta's limit is 25. The library's wording stands.
    expect("Check back in 2 weeks".length).toBe(21);
    expect(MAX_BUTTON_CHARS).toBe(25);
    expect(byId("T9").buttons).toContain("Check back in 2 weeks");
  });

  it("catches a label the router does not know", () => {
    const t = rnrTemplates(base);
    t[0].buttons = ["Ring me immediately"];
    expect(validateButtons(t)[0]).toMatch(/route to nothing/);
  });

  it("catches a label over the limit", () => {
    const t = rnrTemplates(base);
    t[0].buttons = ["Please call me back this afternoon"];
    expect(validateButtons(t).some(p => /characters/.test(p))).toBe(true);
  });

  it("catches two buttons with the same text, which Meta rejects", () => {
    const t = rnrTemplates(base);
    t[0].buttons = ["Request a callback", "Request a callback"];
    expect(validateButtons(t).some(p => /same text/.test(p))).toBe(true);
  });
});

describe("the three ways Meta rejects a body", () => {
  it("no body starts or ends with a variable", () => {
    for (const t of all) {
      expect(t.body.trim(), `${t.templateName} starts with a variable`).not.toMatch(/^\{\{\d+\}\}/);
      expect(t.body.trim(), `${t.templateName} ends with a variable`).not.toMatch(/\{\{\d+\}\}$/);
    }
  });

  it("catches one that does", () => {
    const t = rnrTemplates(base);
    t[0].body = "{{1}}, welcome";
    expect(validateButtons(t).some(p => /starts with a variable/.test(p))).toBe(true);
  });

  it("every variable has a sample and a token to fill it from", () => {
    for (const t of all) {
      const vars = new Set([...t.body.matchAll(/\{\{(\d+)\}\}/g)].map(m => m[1]));
      expect(t.exampleValues, `${t.templateName} samples`).toHaveLength(vars.size);
      expect(t.params, `${t.templateName} params`).toHaveLength(vars.size);
    }
  });

  it("numbers the variables from 1 with no gaps", () => {
    for (const t of all) {
      const nums = [...t.body.matchAll(/\{\{(\d+)\}\}/g)].map(m => Number(m[1]));
      expect(nums, t.templateName).toEqual(nums.map((_, i) => i + 1));
    }
  });

  it("catches a missing sample", () => {
    const t = rnrTemplates(base);
    t[2].exampleValues = [];
    expect(validateButtons(t).some(p => /sample/.test(p))).toBe(true);
  });
});

describe("who each step is for", () => {
  it("R+1 and R+28 go to everyone", () => {
    expect(byId("T3").audience).toBeNull();
    expect(byId("T9").audience).toBeNull();
  });

  // The CRM field is "Product Name", not "course" — checked against the live
  // contacts, where nothing at all carries "course".
  const PN = "Product Name";

  it("keys the rules on the field LeadSquared actually uses", () => {
    expect(byId("T4").audience?.attrIn?.[PN]).toBeTruthy();
    expect(byId("T6").audience?.attrIn?.[PN]).toBeTruthy();
    expect(byId("T4").audience?.attrIn?.course).toBeUndefined();
  });

  it("R+2 skips courses with no confirmed role pair", () => {
    // The library says "Everyone", but its own roles table has no pair for
    // AI for Managers — "managers are not changing roles". There is no
    // honest sentence for them.
    const courses = byId("T4").audience?.attrIn?.[PN] ?? [];
    expect(courses).toContain("Adv. Cert. in Data Analytics & AI");
    expect(courses).not.toContain("AI for Managers");
  });

  it("R+10 goes only to the programmes that carry the terms", () => {
    const courses = byId("T6").audience?.attrIn?.[PN] ?? [];
    expect(courses).toContain("Adv. Cert. in Data Analytics & AI");
    expect(courses).toContain("Full Stack AI");
    expect(courses.some(c => /executive/i.test(c))).toBe(true);
    // Data Science with GenAI moved INTO this audience on 14 Oct: Tanvi
    // confirmed it is the renamed Data Science course and still carries the
    // ₹6L terms. It was held out only while that was unknown.
    expect(courses).toContain("Adv. Cert. in Data Science & GenAI");
    for (const c of ["GenAI", "Agentic AI", "Certified Business Analytics", "AI for Managers"]) {
      expect(courses, `${c} does not carry these terms`).not.toContain(c);
    }
  });

  it("R+15 is centre cities AND only the classroom courses", () => {
    const a = byId("T7").audience;
    expect(a?.attrIn?.city).toContain("bangalore");
    expect(a?.attrIn?.city).toContain("noida");
    expect(a?.attrIn?.[PN]).toContain("Certified Business Analytics");
    // Full Stack AI carries the refund terms but is online only, so it gets
    // R+10 and must not get R+15.
    expect(a?.attrIn?.[PN]).not.toContain("Full Stack AI");
  });

  it("R+5 skips leads already registered", () => {
    expect(byId("T5").audience).toEqual({ lacksTag: [MASTERCLASS_TAG] });
  });

  it("uses the CRM's own attribute names when they are given", () => {
    const t = rnrTemplates({ ...base, courseAttr: "mx_Course", cityAttr: "mx_City" });
    expect(t.find(x => x.id === "T6")?.audience?.attrIn?.mx_Course).toBeTruthy();
    expect(t.find(x => x.id === "T7")?.audience?.attrIn?.mx_City).toBeTruthy();
  });
});

describe("the params are per-lead tokens, not fixed text", () => {
  it("every param is a {token}, so it resolves per lead at send time", () => {
    // A literal here would greet four thousand people by the same name.
    for (const t of all) {
      for (const p of t.params) expect(p, `${t.templateName}: ${p}`).toMatch(/^\{\w+\}$/);
    }
  });

  it("R+10's only variable is the CTC, which differs by programme", () => {
    expect(byId("T6").params).toEqual(["{min_ctc}"]);
  });

  it("R+2 needs both roles, which come from the course", () => {
    expect(byId("T4").params).toEqual(["{first_name}", "{course}", "{role_1}", "{role_2}"]);
  });
});

describe("the template drafts", () => {
  const drafts = templateDrafts(all);

  it("is everything, including the held ones — approval takes time", () => {
    expect(drafts).toHaveLength(9);
  });

  it("every step is MARKETING", () => {
    for (const d of drafts) expect(d.category).toBe("MARKETING");
  });

  it("carries the buttons through as quick replies", () => {
    expect(drafts.every(d => d.buttons?.every(b => b.type === "QUICK_REPLY"))).toBe(true);
  });
});

describe("the sequence's own settings", () => {
  const s = rnrSequenceSettings(base);

  it("sends between 10 and 8 — the messaging window, not the calling one", () => {
    expect(s.sendStartHour).toBe(10);
    expect(s.sendEndHour).toBe(20);
  });

  it("stops the moment the lead replies", () => expect(s.stopOnReply).toBe(true));
  it("sends at most one message a day", () => expect(s.maxPerDay).toBe(1));
  it("skips a lead who wrote to us in the last three days", () => expect(s.skipIfRecentReplyDays).toBe(3));
  it("is pinned to the number it was given", () => expect(s.channelId).toBe("ch-ppc-sm"));
  it("is a sales journey", () => expect(s.team).toBe("sales"));
});
