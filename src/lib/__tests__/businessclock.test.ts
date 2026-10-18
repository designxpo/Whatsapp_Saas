// Proof that the time rules hold on a UTC server.
//
// Every assertion below is written as an explicit UTC INSTANT, never as
// `new Date(y, m, d, h)`. That is the whole point: a local-constructed Date
// means something different depending on the machine running the test, which
// is exactly how production ended up sending at half past one in the morning
// while the suite stayed green on an IST laptop.
//
// The "old behaviour" comments record what each case did on Vercel before
// businessclock.ts existed. They are the regression this file locks shut.
import { describe, it, expect, afterEach, beforeAll, afterAll } from "vitest";

// THIS FILE RUNS AS VERCEL DOES.
//
// vitest.config.ts pins the suite to Asia/Kolkata so the older fixtures, which
// are written in business-local terms, mean the same thing on every machine.
// That pin would also hide the bug this module exists to fix: code still
// reading the SERVER's clock looks correct when the server is already IST.
//
// So this file forces the process to UTC. Any accessor that slipped back to
// server-local fails here, which is the only reason these assertions are
// worth anything.
const REAL_TZ = process.env.TZ;
beforeAll(() => { process.env.TZ = "UTC"; });
afterAll(() => { if (REAL_TZ === undefined) delete process.env.TZ; else process.env.TZ = REAL_TZ; });

describe("the harness itself", () => {
  // If Node ever stops honouring a runtime TZ change, every assertion below
  // silently weakens into "IST machine agrees with itself". This fails loudly
  // instead.
  it("really is pretending to be a UTC server", () => {
    expect(new Date("2026-10-01T05:00:00Z").getHours()).toBe(5);
  });
});
import {
  BUSINESS_TZ, partsIn, hourIn, weekdayIn, sameDayIn, instantAt, atHourIn, addDaysIn, startOfDayIn,
} from "@/lib/businessclock";
import { withinSendWindow, nextWindowOpening, nextDayOpening, localDayBounds } from "@/lib/seqwindow";
import { clampToCallHours, callbackAt, DEFAULT_CALL_HOURS } from "@/lib/callbackslot";

const U = (iso: string) => new Date(iso);
const iso = (d: Date) => d.toISOString();

describe("the business timezone", () => {
  afterEach(() => { delete process.env.BUSINESS_TZ; });

  it("is India, without anyone having to configure it", () => {
    expect(BUSINESS_TZ()).toBe("Asia/Kolkata");
  });

  it("can be moved for a second office without a deploy", () => {
    process.env.BUSINESS_TZ = "Asia/Dubai";
    expect(BUSINESS_TZ()).toBe("Asia/Dubai");
    expect(hourIn(U("2026-10-01T06:00:00Z"))).toBe(10);   // +4
  });

  it("ignores a blank override rather than falling into UTC", () => {
    process.env.BUSINESS_TZ = "   ";
    expect(BUSINESS_TZ()).toBe("Asia/Kolkata");
  });
});

describe("reading the clock", () => {
  it("reads 05:00 UTC as half past ten in the morning", () => {
    expect(partsIn(U("2026-10-01T05:00:00Z"))).toEqual({
      year: 2026, month: 10, day: 1, hour: 10, minute: 30, second: 0,
    });
  });

  it("rolls the date over at 18:30 UTC, not at midnight UTC", () => {
    expect(partsIn(U("2026-10-01T18:29:00Z")).day).toBe(1);
    expect(partsIn(U("2026-10-01T18:30:00Z")).day).toBe(2);
  });

  it("gets the weekday from the business day, not the server's", () => {
    // 2026-10-03 is a Saturday in India. At 18:30 UTC on the 2nd it already is.
    expect(weekdayIn(U("2026-10-02T18:30:00Z"))).toBe(6);
    expect(weekdayIn(U("2026-10-02T18:29:00Z"))).toBe(5);
  });

  it("knows two instants either side of UTC midnight are the same working day", () => {
    // 23:00 and 01:00 UTC are 04:30 and 06:30 IST — one morning, one day.
    expect(sameDayIn(U("2026-10-01T23:00:00Z"), U("2026-10-02T01:00:00Z"))).toBe(true);
  });

  it("and that two instants inside one UTC day can be different working days", () => {
    expect(sameDayIn(U("2026-10-01T18:00:00Z"), U("2026-10-01T19:00:00Z"))).toBe(false);
  });
});

describe("building an instant from a wall clock", () => {
  it("10:00 in India is 04:30 UTC", () => {
    expect(iso(instantAt({ year: 2026, month: 10, day: 1, hour: 10 }))).toBe("2026-10-01T04:30:00.000Z");
  });

  it("midnight in India is the previous evening in UTC", () => {
    expect(iso(instantAt({ year: 2026, month: 10, day: 2, hour: 0 }))).toBe("2026-10-01T18:30:00.000Z");
  });

  it("resolves a wall time that sits just AFTER a spring-forward", () => {
    // New York, 8 March 2026: 02:00 EST becomes 03:00 EDT at 07:00 UTC.
    // 03:30 EDT is a real moment and it is 07:30 UTC.
    //
    // This is the case a single pass gets wrong. The naive instant
    // (03:30 "UTC") lands at 22:30 the previous evening in New York, which is
    // still EST at -5, so one correction overshoots to 08:30 UTC — an hour
    // late, which is 04:30 EDT. Correcting twice converges on the truth.
    expect(iso(instantAt({ year: 2026, month: 3, day: 8, hour: 3, minute: 30 }, "America/New_York")))
      .toBe("2026-03-08T07:30:00.000Z");
  });

  it("survives a zone that actually has daylight saving", () => {
    // London: 1 July is BST (+1), 1 January is GMT (+0). One pass would put
    // one of these an hour out.
    expect(iso(instantAt({ year: 2026, month: 7, day: 1, hour: 12 }, "Europe/London"))).toBe("2026-07-01T11:00:00.000Z");
    expect(iso(instantAt({ year: 2026, month: 1, day: 1, hour: 12 }, "Europe/London"))).toBe("2026-01-01T12:00:00.000Z");
  });
});

describe("moving around the business calendar", () => {
  it("atHourIn lands on the hour in India, whatever the server thinks", () => {
    expect(iso(atHourIn(U("2026-10-01T05:00:00Z"), 10))).toBe("2026-10-01T04:30:00.000Z");
  });

  it("atHourIn uses the business day — late UTC evening is already tomorrow", () => {
    // 19:00 UTC on the 1st is 00:30 on the 2nd in India, so "10 AM" is the 2nd's.
    expect(iso(atHourIn(U("2026-10-01T19:00:00Z"), 10))).toBe("2026-10-02T04:30:00.000Z");
  });

  it("addDaysIn rolls the month over", () => {
    expect(partsIn(addDaysIn(U("2026-10-31T06:00:00Z"), 1))).toMatchObject({ year: 2026, month: 11, day: 1 });
  });

  it("addDaysIn rolls the year over", () => {
    expect(partsIn(addDaysIn(U("2026-12-31T06:00:00Z"), 1))).toMatchObject({ year: 2027, month: 1, day: 1 });
  });

  it("startOfDayIn is 18:30 UTC the previous evening", () => {
    expect(iso(startOfDayIn(U("2026-10-01T05:00:00Z")))).toBe("2026-09-30T18:30:00.000Z");
  });
});

// ── What this was actually doing to leads ──────────────────────────────────

describe("the send window, as production experiences it", () => {
  const w = { startHour: 10, endHour: 20 };     // the RNR sequence's own window

  it("is OPEN at 10:30 in the morning", () => {
    // OLD on Vercel: hour 5 → shut. The morning's drip silently deferred.
    expect(withinSendWindow(w, U("2026-10-01T05:00:00Z"))).toBe(true);
  });

  it("is SHUT at half past nine at night", () => {
    // OLD on Vercel: hour 16 → open. Messages at 21:30.
    expect(withinSendWindow(w, U("2026-10-01T16:00:00Z"))).toBe(false);
  });

  it("is SHUT at half past midnight", () => {
    // OLD on Vercel: hour 19 → open. This is the 1 AM message.
    expect(withinSendWindow(w, U("2026-10-01T19:00:00Z"))).toBe(false);
  });

  it("is SHUT at half past four in the morning", () => {
    expect(withinSendWindow(w, U("2026-10-01T23:00:00Z"))).toBe(false);
  });

  it("opens again at ten, not at some UTC hour", () => {
    // 08:30 IST, before opening → today's 10:00 IST.
    expect(iso(nextWindowOpening(w, U("2026-10-01T03:00:00Z")))).toBe("2026-10-01T04:30:00.000Z");
  });

  it("at exactly the opening hour, defers to TOMORROW", () => {
    // 10:00 IST sharp, with a 10–20 window. Callers only ask when they are
    // OUTSIDE the window, so this is the "at or after the close" branch and
    // must not answer "now" — which is what a <= here would do.
    expect(iso(nextWindowOpening(w, U("2026-10-01T04:30:00Z")))).toBe("2026-10-02T04:30:00.000Z");
  });

  it("defers past the close to tomorrow morning", () => {
    // 21:30 IST on the 1st → 10:00 IST on the 2nd.
    expect(iso(nextWindowOpening(w, U("2026-10-01T16:00:00Z")))).toBe("2026-10-02T04:30:00.000Z");
  });

  it("defers correctly across a month boundary", () => {
    expect(iso(nextWindowOpening(w, U("2026-10-31T16:00:00Z")))).toBe("2026-11-01T04:30:00.000Z");
  });

  it("nextDayOpening is tomorrow's opening even when asked mid-window", () => {
    expect(iso(nextDayOpening(w, U("2026-10-01T05:00:00Z")))).toBe("2026-10-02T04:30:00.000Z");
  });

  it("with no window at all, the day still turns at Indian midnight", () => {
    expect(iso(nextDayOpening({ startHour: null, endHour: null }, U("2026-10-01T05:00:00Z"))))
      .toBe("2026-10-01T18:30:00.000Z");
  });
});

describe("the one-a-day cap counts an Indian day", () => {
  it("brackets the working day, not 00:00–24:00 UTC", () => {
    const { from, to } = localDayBounds(U("2026-10-01T05:00:00Z"));
    expect(iso(from)).toBe("2026-09-30T18:30:00.000Z");
    expect(iso(to)).toBe("2026-10-01T18:30:00.000Z");
  });

  it("does not reset in the middle of a working morning", () => {
    // OLD: UTC midnight = 05:30 IST, so a 05:00 and an 06:00 IST message
    // counted as two different days. Both of these are one Indian day.
    const a = localDayBounds(U("2026-09-30T23:30:00Z"));   // 05:00 IST
    const b = localDayBounds(U("2026-10-01T00:30:00Z"));   // 06:00 IST
    expect(iso(a.from)).toBe(iso(b.from));
  });
});

describe("calling hours are Indian calling hours", () => {
  it("11:30 in the morning is inside them and is left alone", () => {
    // OLD on Vercel: hour 6 < 11 → pushed to 11:00 UTC, which is 16:30 IST.
    const at = U("2026-10-01T06:00:00Z");
    expect(iso(clampToCallHours(at, DEFAULT_CALL_HOURS))).toBe(iso(at));
  });

  it("half past nine at night becomes tomorrow at eleven", () => {
    expect(iso(clampToCallHours(U("2026-10-01T16:00:00Z"), DEFAULT_CALL_HOURS)))
      .toBe("2026-10-02T05:30:00.000Z");
  });

  it("half past eight in the morning waits for eleven the same day", () => {
    expect(iso(clampToCallHours(U("2026-10-01T03:00:00Z"), DEFAULT_CALL_HOURS)))
      .toBe("2026-10-01T05:30:00.000Z");
  });
});

describe("the weekend is the business's weekend", () => {
  it("counts a Saturday that UTC still thinks is Friday", () => {
    // 2026-10-02T19:00Z is 00:30 on Saturday 3 October in India, and still
    // Friday evening in UTC. A lead tapping "this weekend" then means the
    // Saturday that has just begun for them — 11:00 that same morning.
    //
    // Reading the server's clock gives Friday, so the slot slides a whole
    // week; treating only Sunday as the weekend does the same thing.
    expect(iso(callbackAt("this weekend", U("2026-10-02T19:00:00Z"), DEFAULT_CALL_HOURS)))
      .toBe("2026-10-03T05:30:00.000Z");
  });

  it("a Saturday whose calling hours are over rolls to the NEXT Saturday", () => {
    // 2026-10-03T13:00Z is 18:30 Saturday in India — past the 17:00 close.
    expect(iso(callbackAt("this weekend", U("2026-10-03T13:00:00Z"), DEFAULT_CALL_HOURS)))
      .toBe("2026-10-10T05:30:00.000Z");
  });
});
