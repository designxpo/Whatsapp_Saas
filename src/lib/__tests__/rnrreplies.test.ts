// What the lead hears back when they tap.
//
// Transcribed from section 2 of the RNR WhatsApp Message Library. The two
// tests that matter most are the button-limit sweep — an interactive reply
// button may be 20 characters, not the template's 25 — and the degradation
// cases, because the counsellor's name is missing far more often than
// anybody expects and "undefined will call you" is what that looks like.
import { describe, it, expect } from "vitest";
import {
  replyForTap, replyButtonProblems,
  INTERACTIVE_BUTTON_CHARS, MAX_INTERACTIVE_BUTTONS, HIDE_LATER_TODAY_AFTER,
} from "@/lib/rnrreplies";
import { RNR_TAPS, planForTap } from "@/lib/rnrtaps";

const T = { first_name: "Rahul", counsellor_name: "Neha", course: "Data Analytics" };
// 1 October 2026, a Thursday. Noon is inside the 11–5 calling window.
const NOON = new Date(2026, 9, 1, 12, 0, 0);
const NIGHT = new Date(2026, 9, 1, 22, 0, 0);

describe("every tap gets an answer", () => {
  it("no template button leaves the lead in silence", () => {
    // A button that appears to do nothing is a button nobody presses twice.
    for (const t of RNR_TAPS) {
      expect(replyForTap(t.label, T, NOON).text, `"${t.label}" says nothing back`).toBeTruthy();
    }
  });

  it("a typed reply gets no canned answer", () => {
    // A counsellor is already being alerted. Answering a real question with
    // an automated platitude is worse than letting the human speak first.
    expect(replyForTap("what are the fees?", T, NOON).text).toBe("");
  });
});

describe("Meta's two button limits are different, and both are respected", () => {
  it("no reply offers a button over 20 characters", () => {
    // The trap: a template quick-reply may be 25. An interactive reply
    // button may be 20. "Check back in 2 weeks" is 21 — legal on T9, one
    // character too long here, and Meta truncates rather than refusing, so
    // it would come back as "Check back in 2 week" and match nothing.
    const plans = RNR_TAPS.map(t => replyForTap(t.label, T, NOON));
    expect(replyButtonProblems(plans)).toEqual([]);
  });

  it("the interactive limit really is 20, not the template's 25", () => {
    expect(INTERACTIVE_BUTTON_CHARS).toBe(20);
  });

  it("'Just exploring' uses the 20-character spelling", () => {
    const p = replyForTap("Just exploring", T, NOON);
    expect(p.buttons).toContain("Remind me in 2 weeks");
    expect(p.buttons).not.toContain("Check back in 2 weeks");
    expect("Remind me in 2 weeks".length).toBe(20);
    expect("Check back in 2 weeks".length).toBe(21);
  });

  it("never offers more than three buttons", () => {
    for (const t of RNR_TAPS) {
      expect(replyForTap(t.label, T, NOON, { masterclassLive: true }).buttons.length)
        .toBeLessThanOrEqual(MAX_INTERACTIVE_BUTTONS);
    }
  });

  it("catches a button that is too long", () => {
    expect(replyButtonProblems([{ text: "x", buttons: ["Please call me back this afternoon"] }])[0])
      .toMatch(/characters/);
  });

  it("catches a button the router does not know", () => {
    expect(replyButtonProblems([{ text: "x", buttons: ["Maybe later"] }])[0]).toMatch(/do nothing/);
  });
});

describe("'Yes, call me now' promises only what the task will deliver", () => {
  // The reply and the CRM task are derived from the same moment. Asking
  // "is it office hours right now" instead gets both edges wrong.
  const dueAt = (now: Date) => new Date(planForTap("Yes, call me now", now).task!.dueAt);
  const within30 = (now: Date) => dueAt(now).getTime() - now.getTime() <= 31 * 60_000;

  it("inside calling hours, promises thirty minutes", () => {
    expect(replyForTap("Yes, call me now", T, NOON).text)
      .toBe("Thanks, Rahul. Neha will call you within 30 minutes.");
    expect(within30(NOON)).toBe(true);
  });

  it("outside them, promises the morning instead of a call at ten at night", () => {
    const r = replyForTap("Yes, call me now", T, NIGHT).text;
    expect(r).toContain("between 11 AM and 5 PM");
    expect(r).toContain("as soon as we open");
    expect(r).not.toContain("within 30 minutes");
  });

  it("before opening counts as outside", () => {
    expect(replyForTap("Yes, call me now", T, new Date(2026, 9, 1, 9, 0)).text).toContain("as soon as we open");
  });

  it("LATE in the window does too — the half hour would fall past closing", () => {
    // 16:56 is inside 11–5, so the old check said "open" and promised
    // thirty minutes, while callbackslot deferred the task to 11:00
    // tomorrow. The lead was told one thing and the counsellor another.
    const late = new Date(2026, 9, 1, 16, 56);
    expect(within30(late)).toBe(false);
    const r = replyForTap("Yes, call me now", T, late).text;
    expect(r).toContain("as soon as we open");
    expect(r).not.toContain("within 30 minutes");
  });

  it("the promise and the task agree at every hour of the day", () => {
    for (let hh = 0; hh < 24; hh++) {
      for (const mm of [0, 29, 45, 59]) {
        const now = new Date(2026, 9, 1, hh, mm);
        const promised = replyForTap("Yes, call me now", T, now).text.includes("within 30 minutes");
        expect(promised, `${hh}:${String(mm).padStart(2, "0")}`).toBe(within30(now));
      }
    }
  });

  it("'Request a callback' makes the same promise, so it gets the same guard", () => {
    const late = new Date(2026, 9, 1, 16, 56);
    expect(replyForTap("Request a callback", T, NOON).text).toContain("within 30 minutes");
    expect(replyForTap("Request a callback", T, late).text).toContain("as soon as we open");
    expect(replyForTap("Yes, keep it open", T, late).text).toContain("as soon as we open");
  });
});

describe("'Yes, call me later' offers the slots that still exist", () => {
  it("offers all three in the morning", () => {
    expect(replyForTap("Yes, call me later", T, NOON).buttons)
      .toEqual(["Later today", "Tomorrow morning", "Tomorrow afternoon"]);
  });

  it("drops 'Later today' after 4 PM — the library's rule", () => {
    // Offering a slot that can no longer be honoured is the same broken
    // promise as ignoring the tap.
    expect(replyForTap("Yes, call me later", T, new Date(2026, 9, 1, 16, 30)).buttons)
      .toEqual(["Tomorrow morning", "Tomorrow afternoon"]);
    expect(HIDE_LATER_TODAY_AFTER).toBe(16);
  });

  it("still offers it at 3:59 PM", () => {
    expect(replyForTap("Yes, call me later", T, new Date(2026, 9, 1, 15, 59)).buttons)
      .toContain("Later today");
  });
});

describe("the second level of the slot flow", () => {
  it("'Call me tomorrow' asks which half of the day", () => {
    const p = replyForTap("Call me tomorrow", T, NOON);
    expect(p.text).toBe("Sure. Morning or afternoon?");
    expect(p.buttons).toEqual(["11 AM to 1 PM", "1 PM to 5 PM"]);
  });

  it("confirms the half they picked, by name", () => {
    expect(replyForTap("11 AM to 1 PM", T, NOON).text).toContain("tomorrow between 11 AM and 1 PM");
    expect(replyForTap("1 PM to 5 PM", T, NOON).text).toContain("tomorrow between 1 PM and 5 PM");
  });

  it("'Later today' promises before 5 PM, as the library says", () => {
    expect(replyForTap("Later today", T, NOON).text).toBe("Done. Neha will call you before 5 PM today.");
  });
});

describe("degrading without a counsellor", () => {
  it("says 'A counsellor', never a blank or 'undefined'", () => {
    const bare = { first_name: "Rahul" };
    expect(replyForTap("Later today", bare, NOON).text).toBe("Done. A counsellor will call you before 5 PM today.");
    expect(replyForTap("Yes, call me now", bare, NOON).text).toContain("A counsellor will call you");
  });

  it("reads correctly mid-sentence too", () => {
    expect(replyForTap("Chat on WhatsApp", {}, NOON).text)
      .toBe("Sure. Type your question here and a counsellor will reply between 11 AM and 5 PM.");
  });

  it("no reply ever contains 'undefined' or a dangling blank", () => {
    for (const t of RNR_TAPS) {
      const text = replyForTap(t.label, {}, NOON).text;
      expect(text, t.label).not.toMatch(/undefined|null/);
      expect(text, t.label).not.toMatch(/\s,|\s\./);      // "Thanks, ." / "for  ."
      expect(text, t.label).not.toMatch(/: *$/);          // a bare trailing colon
    }
  });

  it("greets without a name rather than 'Thanks, .'", () => {
    expect(replyForTap("Request a callback", {}, NOON).text).toMatch(/^Thanks\. A counsellor/);
  });
});

describe("replies that need data we may not have", () => {
  it("'Send course details' drops the link when there is none", () => {
    const r = replyForTap("Send course details", T, NOON).text;
    expect(r).toContain("Data Analytics");
    expect(r).not.toContain("http");
    expect(r).not.toMatch(/: *\./);
  });

  it("uses the link when there is one", () => {
    const r = replyForTap("Send course details", { ...T, course_link: "https://x.test/da" }, NOON).text;
    expect(r).toContain("https://x.test/da");
  });

  it("'Register me' does not promise a masterclass it cannot name", () => {
    // T5 is on hold for want of a schedule. "You're in.  at ." is worse
    // than saying somebody will follow up.
    const r = replyForTap("Register me", T, NOON).text;
    expect(r).toMatch(/details shortly/);
    expect(r).not.toContain("You're in");
  });

  it("confirms properly once a session is known", () => {
    const r = replyForTap("Register me", {
      ...T, masterclass_topic: "Excel to AI", masterclass_date: "Sunday 11 October",
      masterclass_time: "11 AM", join_link: "https://x.test/j",
    }, NOON).text;
    expect(r).toBe("You're in. Excel to AI, Sunday 11 October at 11 AM. Join here: https://x.test/j");
  });

  it("'Book a centre visit' drops the address when there is none", () => {
    expect(replyForTap("Book a centre visit", T, NOON).text).not.toContain("Address:");
    expect(replyForTap("Book a centre visit", { ...T, centre_address: "Sector 44" }, NOON).text)
      .toContain("Address: Sector 44");
  });

  it("only offers the masterclass button once T5 is live", () => {
    expect(replyForTap("Just exploring", T, NOON).buttons).not.toContain("Free masterclass");
    expect(replyForTap("Just exploring", T, NOON, { masterclassLive: true }).buttons).toContain("Free masterclass");
  });
});

describe("the endings", () => {
  it("'Yes, keep it open' reads the same as a callback request", () => {
    expect(replyForTap("Yes, keep it open", T, NOON).text)
      .toBe(replyForTap("Request a callback", T, NOON).text);
  });

  it("closing says so, and leaves a way back", () => {
    const r = replyForTap("Close my enquiry", T, NOON).text;
    expect(r).toContain("won't message you again");
    expect(r).toContain("START");
  });

  it("both spellings of the snooze say the same thing", () => {
    expect(replyForTap("Check back in 2 weeks", T, NOON).text)
      .toBe(replyForTap("Remind me in 2 weeks", T, NOON).text);
  });

  it("the refund answer states the condition, never a guarantee", () => {
    const r = replyForTap("How the refund works", T, NOON).text;
    expect(r).toContain("50%");
    expect(r).toContain("6 months");
    expect(r.toLowerCase()).not.toContain("guarantee");
  });
});

describe("the editing rules the library sets", () => {
  it("no reply promises a job or a salary", () => {
    for (const t of RNR_TAPS) {
      expect(replyForTap(t.label, T, NOON).text.toLowerCase(), t.label).not.toContain("guarantee");
    }
  });

  it("no reply names an IIT", () => {
    for (const t of RNR_TAPS) {
      expect(replyForTap(t.label, T, NOON).text.toLowerCase(), t.label).not.toContain("iit");
    }
  });
});
