// The counsellor presses one button after a call nobody answered.
//
// The table below is the brief's, section 1, transcribed rather than read
// back out of the implementation:
//
//     Day 0, 1st call   Send Message A
//     Day 0, later      Nothing
//     Day 1, 1st call   Send Message B, only if no reply to A
//     Day 1, later      Nothing
//
// The second press of the day is the case that matters. A counsellor makes
// several attempts; the button must be safe to hit after every one of them.
import { describe, it, expect } from "vitest";
import {
  decideNudge, attrFor, NUDGE_A_TEMPLATE, NUDGE_B_TEMPLATE,
  NUDGE_A_ATTR, NUDGE_B_ATTR, RECENT_INBOUND_HOURS,
} from "@/lib/rnrnudge";

const DAY0_10AM = new Date(2026, 9, 1, 10, 0, 0);
const DAY0_3PM = new Date(2026, 9, 1, 15, 0, 0);
const DAY1_10AM = new Date(2026, 9, 2, 10, 0, 0);
const DAY1_3PM = new Date(2026, 9, 2, 15, 0, 0);
const DAY2_10AM = new Date(2026, 9, 3, 10, 0, 0);

const base = {
  optedOut: false, notOnWhatsApp: false,
  sentA: null as string | null, sentB: null as string | null,
  lastInboundAt: null as string | null,
};
const at = (d: Date) => d.toISOString();

describe("the brief's table, line by line", () => {
  it("Day 0, first call → Message A", () => {
    const d = decideNudge({ ...base, now: DAY0_10AM });
    expect(d.send).toBe("A");
    expect(d).toMatchObject({ template: NUDGE_A_TEMPLATE });
  });

  it("Day 0, a later call → nothing", () => {
    // The press that must be harmless. A counsellor tries three times in an
    // afternoon and hits the button each time.
    const d = decideNudge({ ...base, now: DAY0_3PM, sentA: at(DAY0_10AM) });
    expect(d.send).toBeNull();
    expect(d.why).toMatch(/already went to this lead today/);
  });

  it("Day 1, first call → Message B", () => {
    const d = decideNudge({ ...base, now: DAY1_10AM, sentA: at(DAY0_10AM) });
    expect(d.send).toBe("B");
    expect(d).toMatchObject({ template: NUDGE_B_TEMPLATE });
  });

  it("Day 1, a later call → nothing", () => {
    const d = decideNudge({ ...base, now: DAY1_3PM, sentA: at(DAY0_10AM), sentB: at(DAY1_10AM) });
    expect(d.send).toBeNull();
  });

  it("Day 1 → NOTHING when the lead replied to Message A", () => {
    // The brief singles this out: "Send Message B, only if no reply to A."
    const d = decideNudge({
      ...base, now: DAY1_10AM,
      sentA: at(DAY0_10AM), lastInboundAt: at(DAY0_3PM),
    });
    expect(d.send).toBeNull();
    expect(d.why).toMatch(/replied after your last message/);
  });

  it("Day 2 onwards → nothing; the drip takes over", () => {
    const d = decideNudge({ ...base, now: DAY2_10AM, sentA: at(DAY0_10AM), sentB: at(DAY1_10AM) });
    expect(d.send).toBeNull();
    expect(d.why).toMatch(/Not Reachable/);
  });
});

describe("never the same message twice", () => {
  it("A is sent once, however many days pass", () => {
    const d = decideNudge({ ...base, now: DAY2_10AM, sentA: at(DAY0_10AM) });
    expect(d.send).toBe("B");          // B, not A again
  });

  it("B is sent once", () => {
    const d = decideNudge({ ...base, now: new Date(2026, 9, 20), sentA: at(DAY0_10AM), sentB: at(DAY1_10AM) });
    expect(d.send).toBeNull();
  });

  it("the attribute each one records is distinct", () => {
    expect(attrFor("A")).toBe(NUDGE_A_ATTR);
    expect(attrFor("B")).toBe(NUDGE_B_ATTR);
    expect(NUDGE_A_ATTR).not.toBe(NUDGE_B_ATTR);
  });
});

describe("one a day, by the calendar", () => {
  it("a minute before midnight and a minute after are different days", () => {
    const late = new Date(2026, 9, 1, 23, 59);
    const early = new Date(2026, 9, 2, 0, 1);
    expect(decideNudge({ ...base, now: late, sentA: at(new Date(2026, 9, 1, 9, 0)) }).send).toBeNull();
    expect(decideNudge({ ...base, now: early, sentA: at(new Date(2026, 9, 1, 9, 0)) }).send).toBe("B");
  });

  it("counts from the LATER of the two, not just from A", () => {
    // B went out this morning; A was days ago. The cap must read B.
    const d = decideNudge({ ...base, now: DAY1_3PM, sentA: at(DAY0_10AM), sentB: at(DAY1_10AM) });
    expect(d.why).toMatch(/already went to this lead today/);
  });
});

describe("a lead who is already talking to us", () => {
  it("gets nothing, even before anything was sent", () => {
    // Firing "we just tried calling you" at somebody mid-conversation is
    // the thing that makes automation feel cheap.
    const d = decideNudge({ ...base, now: DAY0_3PM, lastInboundAt: at(DAY0_10AM) });
    expect(d.send).toBeNull();
    expect(d.why).toMatch(/last 24 hours/);
  });

  it("an OLD inbound does not block the first message", () => {
    // An enquiry three weeks ago is not a conversation.
    const d = decideNudge({ ...base, now: DAY0_3PM, lastInboundAt: at(new Date(2026, 8, 10)) });
    expect(d.send).toBe("A");
  });

  it("the cutoff is 24 hours", () => {
    const justInside = new Date(DAY0_3PM.getTime() - (RECENT_INBOUND_HOURS - 1) * 3600_000);
    const justOutside = new Date(DAY0_3PM.getTime() - (RECENT_INBOUND_HOURS + 1) * 3600_000);
    expect(decideNudge({ ...base, now: DAY0_3PM, lastInboundAt: at(justInside) }).send).toBeNull();
    expect(decideNudge({ ...base, now: DAY0_3PM, lastInboundAt: at(justOutside) }).send).toBe("A");
  });

  it("a reply BEFORE the last message does not block the next one", () => {
    // They wrote, we answered with A, they went quiet again. B is right.
    const d = decideNudge({
      ...base, now: DAY1_10AM,
      lastInboundAt: at(new Date(2026, 9, 1, 8, 0)),   // before A
      sentA: at(DAY0_10AM),
    });
    expect(d.send).toBe("B");
  });
});

describe("the two hard stops", () => {
  it("an opted-out lead gets nothing, whatever the table says", () => {
    const d = decideNudge({ ...base, now: DAY0_10AM, optedOut: true });
    expect(d.send).toBeNull();
    expect(d.why).toMatch(/opted out/);
  });

  it("a number with no WhatsApp account gets nothing, and is called out as such", () => {
    const d = decideNudge({ ...base, now: DAY0_10AM, notOnWhatsApp: true });
    expect(d.send).toBeNull();
    expect(d.why).toMatch(/wrong number/);
  });

  it("opt-out outranks everything, including a pending first message", () => {
    const d = decideNudge({ ...base, now: DAY0_10AM, optedOut: true, notOnWhatsApp: true });
    expect(d.why).toMatch(/opted out/);
  });
});

describe("every refusal explains itself", () => {
  it("no decision ever comes back without a reason", () => {
    // A counsellor who presses the button and sees nothing happen is owed a
    // sentence. "Nothing to do" is not one.
    const states = [
      { ...base, now: DAY0_10AM },
      { ...base, now: DAY0_3PM, sentA: at(DAY0_10AM) },
      { ...base, now: DAY1_10AM, sentA: at(DAY0_10AM) },
      { ...base, now: DAY2_10AM, sentA: at(DAY0_10AM), sentB: at(DAY1_10AM) },
      { ...base, now: DAY0_10AM, optedOut: true },
      { ...base, now: DAY0_10AM, notOnWhatsApp: true },
      { ...base, now: DAY1_10AM, sentA: at(DAY0_10AM), lastInboundAt: at(DAY0_3PM) },
    ];
    for (const s of states) {
      const d = decideNudge(s);
      expect(d.why.length, JSON.stringify(s)).toBeGreaterThan(20);
      expect(d.why).toMatch(/\.$/);          // a sentence, not a code
    }
  });
});

describe("rubbish timestamps do not send twice", () => {
  it("an unparseable sentA is treated as never sent", () => {
    expect(decideNudge({ ...base, now: DAY0_10AM, sentA: "not a date" }).send).toBe("A");
  });

  it("an unparseable inbound does not block", () => {
    expect(decideNudge({ ...base, now: DAY0_10AM, lastInboundAt: "nonsense" }).send).toBe("A");
  });
});
