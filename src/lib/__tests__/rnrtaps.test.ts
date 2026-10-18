// What a tapped button means.
//
// Every message in the RNR journey ends in buttons, and the label is the only
// routing key Meta gives us for a template quick-reply. That makes this file
// the thing standing between "lead tapped Yes, call me now" and a counsellor's
// phone — and makes a renamed label a silent outage.
import { describe, it, expect } from "vitest";
import {
  RNR_TAPS, matchTap, normaliseTap, planForTap, CALLBACK_MINUTES, CALL_NOW_MINUTES,
} from "@/lib/rnrtaps";

/** Minutes between now and the task's due moment — what the old API returned. */
const mins = (p: { task: { dueAt: string } | null }, now: Date): number =>
  Math.round((new Date(p.task!.dueAt).getTime() - now.getTime()) / 60_000);


describe("the button catalogue", () => {
  it("has no duplicate labels — a duplicate means one routing is unreachable", () => {
    const seen = RNR_TAPS.map(t => normaliseTap(t.label));
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("every label fits Meta's 25-character quick-reply limit", () => {
    // Meta truncates past 25, and a truncated label no longer matches what
    // comes back — routing would break on approval, not on edit. An earlier
    // pass used 20 and shortened a perfectly valid label on that basis.
    const tooLong = RNR_TAPS.filter(t => t.label.length > 25).map(t => `${t.label} (${t.label.length})`);
    expect(tooLong).toEqual([]);
  });

  it("every spec carries an intent the planner handles", () => {
    const known = new Set(["call_now", "call_slot", "chat", "explore", "register", "snooze", "close"]);
    for (const t of RNR_TAPS) expect(known.has(t.intent)).toBe(true);
  });

  it("every call_slot names the slot, so the task says when", () => {
    for (const t of RNR_TAPS.filter(t => t.intent === "call_slot")) {
      expect(t.slot, `${t.label} has no slot`).toBeTruthy();
    }
  });

  it("every snooze says for how long", () => {
    for (const t of RNR_TAPS.filter(t => t.intent === "snooze")) {
      expect(t.snoozeDays, `${t.label} has no snoozeDays`).toBeGreaterThan(0);
    }
  });

  // The labels themselves are pinned. Changing one is a deliberate act that
  // also means re-approving the template with Meta — this test is the place
  // that makes that visible rather than discovering it four weeks in.
  it("pins the labels the templates will be approved with", () => {
    expect(RNR_TAPS.map(t => t.label)).toEqual([
      // T1
      "Yes, call me now", "Yes, call me later", "Just exploring",
      // T2
      "Call me later today", "Call me tomorrow", "Chat on WhatsApp",
      // T3–T9
      "Request a callback", "Send course details", "Register me", "Not this time",
      "How the refund works", "Book a centre visit", "Share fees and EMI",
      "Yes, keep it open", "Check back in 2 weeks", "Close my enquiry",
      // Second-level buttons we send ourselves, on a normal chat message
      "Later today", "Tomorrow morning", "Tomorrow afternoon",
      "11 AM to 1 PM", "1 PM to 5 PM", "Course details", "Free masterclass",
      "Remind me in 2 weeks",
    ]);
  });
});

describe("matchTap", () => {
  it("matches the exact label", () => {
    expect(matchTap("Yes, call me now")?.intent).toBe("call_now");
  });

  it("matches a lead who TYPED it instead of tapping", () => {
    expect(matchTap("yes, call me now")?.intent).toBe("call_now");
    expect(matchTap("  Close my enquiry  ")?.intent).toBe("close");
  });

  it("tolerates a trailing full stop and collapsed spacing", () => {
    expect(matchTap("Chat on  WhatsApp.")?.intent).toBe("chat");
  });

  it("tolerates a curly apostrophe", () => {
    expect(normaliseTap("Don’t")).toBe("don't");
  });

  it("does NOT substring-match — the opposite meaning must not route", () => {
    // "Do not call me now" contains "call me now" and means the reverse.
    expect(matchTap("Do not call me now")).toBeNull();
    expect(matchTap("please dont close my enquiry")).toBeNull();
  });

  it("returns null for an ordinary question", () => {
    expect(matchTap("what are the fees?")).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(matchTap("")).toBeNull();
  });
});

describe("planForTap — every path stops the journey", () => {
  it("a tap stops it", () => {
    expect(planForTap("Yes, call me now").stopSequence).toBe(true);
  });

  it("a free-text reply stops it too", () => {
    // The most engaged lead in the list is the one who typed a question.
    // Routing only taps would be exactly the wrong way round.
    // Fixed to a moment inside calling hours, so the clamp cannot move it.
    const now = new Date(2026, 9, 1, 14, 0, 0);
    const p = planForTap("what are the fees?", now);
    expect(p.stopSequence).toBe(true);
    expect(p.intent).toBe("reply");
    expect(mins(p, now)).toBe(CALLBACK_MINUTES);
  });

  it("every spec in the catalogue produces a plan with an activity line", () => {
    for (const t of RNR_TAPS) {
      const p = planForTap(t.label);
      expect(p.activity, `${t.label} has no activity`).toBeTruthy();
      expect(p.stopSequence).toBe(true);
    }
  });
});

describe("planForTap — opting out", () => {
  it("'Close my enquiry' opts the lead out", () => {
    const p = planForTap("Close my enquiry");
    expect(p.optOut).toBe(true);
    expect(p.task).toBeNull();   // nothing for a human to chase
  });

  it("it is the ONLY intent that opts out", () => {
    const outs = RNR_TAPS.filter(t => planForTap(t.label).optOut).map(t => t.label);
    expect(outs).toEqual(["Close my enquiry"]);
  });

  it("a snooze does NOT opt out — it is 'later', not 'never'", () => {
    expect(planForTap("Remind me in 2 weeks").optOut).toBe(false);
    expect(planForTap("Not this time").optOut).toBe(false);
  });
});

describe("planForTap — urgency matches what the button promised", () => {
  // 1 October 2026 is a Thursday. 11:00 is inside calling hours, so nothing
  // below is moved by the clamp unless the slot itself asks for it.
  const NOON = new Date(2026, 9, 1, 11, 0, 0);

  it("'call me now' is the 15-minute promise the brief makes", () => {
    expect(mins(planForTap("Yes, call me now", NOON), NOON)).toBe(CALL_NOW_MINUTES);
    expect(mins(planForTap("Talk to a counsellor", NOON), NOON)).toBe(CALL_NOW_MINUTES);
  });

  it("a chosen slot is raised promptly, and the task says which slot", () => {
    const p = planForTap("Call me tomorrow", NOON);
    expect(p.task?.name).toContain("tomorrow");
    expect(p.activity).toContain("tomorrow");
  });

  it("the two halves of tomorrow are told apart", () => {
    expect(planForTap("Tomorrow afternoon", NOON).task?.name).toContain("tomorrow afternoon");
    expect(planForTap("1 PM to 5 PM", NOON).task?.name).toContain("tomorrow afternoon");
  });

  it("'just exploring' is a same-day task, not a 15-minute promise", () => {
    // The brief never promised a call for this button, so the task must not
    // imply one — an unkeepable promise is worse than a slower one.
    expect(mins(planForTap("Just exploring", NOON), NOON)).toBe(240);
  });

  it("a snooze is due in two weeks, not today", () => {
    const p = planForTap("Check back in 2 weeks", NOON);
    const due = new Date(p.task!.dueAt);
    expect(due.getDate()).toBe(15);        // 1 Oct + 14 days
    expect(due.getMonth()).toBe(9);
  });

  it("'chat on WhatsApp' asks for a reply in chat, not a call", () => {
    const p = planForTap("Chat on WhatsApp");
    expect(p.task?.name).toMatch(/WhatsApp/);
    expect(p.task?.notes).toMatch(/not by phone/);
  });
});

describe("planForTap — the lead's own words reach the counsellor", () => {
  it("a free-text reply is quoted in the task", () => {
    expect(planForTap("do you have EMI?").task?.notes).toContain("do you have EMI?");
  });

  it("a very long reply is truncated rather than dropped", () => {
    const long = "x".repeat(500);
    const p = planForTap(long);
    expect(p.task!.notes.length).toBeLessThan(300);
    expect(p.activity.length).toBeLessThan(300);
  });
});
