// "Call me tomorrow afternoon" must mean tomorrow afternoon.
//
// Every one of these buttons used to produce the same task, due in thirty
// minutes, whatever the lead picked. The tests are written from the LEAD's
// expectation — what the button promised them — rather than from the
// arithmetic, so a change to the arithmetic that breaks a promise fails here.
//
// The window is 11 AM to 5 PM, set by the 30 September message library. That
// is when a COUNSELLOR can ring; when we may SEND is a separate 10-to-8
// window that lives on the sequence.
//
// All dates use the local-time Date constructor because every rule here is
// about local hours. October 2026: the 1st is a Thursday, the 3rd a Saturday.
import { describe, it, expect } from "vitest";
import {
  callbackAt, callNowAt, snoozeUntil, clampToCallHours, minutesUntil,
  DEFAULT_CALL_HOURS, CALL_NOW_MINUTES, DEFAULT_CALLBACK_MINUTES,
} from "@/lib/callbackslot";

const at = (day: number, h: number, m = 0) => new Date(2026, 9, day, h, m, 0, 0);
const hhmm = (d: Date) => `${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

describe("the calling window is the library's 11 to 5", () => {
  it("is 11–17, not the messaging window", () => {
    expect(DEFAULT_CALL_HOURS).toEqual({ startHour: 11, endHour: 17 });
  });

  it("leaves a time inside the window exactly where it is", () => {
    expect(hhmm(clampToCallHours(at(1, 14, 37)))).toBe("1 14:37");
  });

  it("pulls an early-morning time forward to opening", () => {
    expect(hhmm(clampToCallHours(at(1, 6, 15)))).toBe("1 11:00");
    expect(hhmm(clampToCallHours(at(1, 10, 30)))).toBe("1 11:00");
  });

  it("pushes an after-hours time to tomorrow's opening", () => {
    // The failure this exists to stop: a tap at 22:40 scheduling a 22:55 call.
    expect(hhmm(clampToCallHours(at(1, 22, 40)))).toBe("2 11:00");
  });

  it("the close is exclusive — 17:00 is already tomorrow", () => {
    expect(hhmm(clampToCallHours(at(1, 17, 0)))).toBe("2 11:00");
    expect(hhmm(clampToCallHours(at(1, 16, 59)))).toBe("1 16:59");
  });

  it("rolls over a month end", () => {
    expect(hhmm(clampToCallHours(new Date(2026, 9, 31, 23, 0)))).toBe("1 11:00");
  });
});

describe("'call me now' — the library promises thirty minutes", () => {
  it("is thirty minutes away", () => {
    const now = at(1, 12, 0);
    expect(minutesUntil(callNowAt(now), now)).toBe(CALL_NOW_MINUTES);
    expect(CALL_NOW_MINUTES).toBe(30);
  });

  it("does not schedule a call for the middle of the night", () => {
    expect(hhmm(callNowAt(at(1, 23, 50)))).toBe("2 11:00");
  });

  it("a tap before opening waits for opening, not thirty minutes", () => {
    expect(hhmm(callNowAt(at(1, 8, 0)))).toBe("1 11:00");
  });
});

describe("'call me later today'", () => {
  it("is soon, and today", () => {
    const now = at(1, 12, 0);
    expect(minutesUntil(callbackAt("later today", now), now)).toBe(DEFAULT_CALLBACK_MINUTES);
    expect(callbackAt("later today", now).getDate()).toBe(1);
  });

  it("lands before 5 PM, as the reply promises", () => {
    expect(callbackAt("later today", at(1, 16, 0)).getHours()).toBeLessThan(17);
  });

  it("rolls to tomorrow morning rather than promising a call at six", () => {
    // The library hides this button after 4 PM for exactly this reason. If
    // one is tapped anyway — a stale message, a slow thumb — the promise
    // that gets kept is a morning call, not an evening one.
    expect(hhmm(callbackAt("later today", at(1, 16, 45)))).toBe("2 11:00");
  });
});

describe("'call me tomorrow' and its two halves", () => {
  it("bare 'tomorrow' is tomorrow morning", () => {
    expect(hhmm(callbackAt("tomorrow", at(1, 12, 0)))).toBe("2 11:00");
  });

  it("'tomorrow morning' is 11 AM tomorrow", () => {
    expect(hhmm(callbackAt("tomorrow morning", at(1, 12, 0)))).toBe("2 11:00");
  });

  it("'tomorrow afternoon' is 1 PM tomorrow — not the morning", () => {
    // "tomorrow afternoon" contains "tomorrow", so a parser that checked the
    // bare day first would send every afternoon request to 11 AM.
    expect(hhmm(callbackAt("tomorrow afternoon", at(1, 12, 0)))).toBe("2 13:00");
  });

  it("reads the hour-range labels the second-level buttons actually send", () => {
    expect(hhmm(callbackAt("11 AM to 1 PM", at(1, 12, 0)))).toBe("2 11:00");
    expect(hhmm(callbackAt("1 PM to 5 PM", at(1, 12, 0)))).toBe("2 13:00");
  });

  it("is never today, whatever time they tapped", () => {
    for (let h = 0; h < 24; h++) expect(callbackAt("tomorrow", at(1, h)).getDate()).toBe(2);
  });
});

describe("slots the library retired", () => {
  it("'this evening' still parses, and lands inside calling hours", () => {
    // No button offers it, but a template approved before the library was
    // written can still be in Meta's list. 6 PM is outside 11–5, so the
    // promise that gets kept is the next morning.
    expect(hhmm(callbackAt("this evening", at(1, 12, 0)))).toBe("2 11:00");
  });

  it("'this weekend' still parses", () => {
    expect(hhmm(callbackAt("this weekend", at(1, 12, 0)))).toBe("3 11:00");   // Thu 1 → Sat 3
  });
});

describe("an unnamed time", () => {
  it("'later' with no slot is the default callback delay", () => {
    const now = at(1, 12, 0);
    expect(minutesUntil(callbackAt("unspecified", now), now)).toBe(DEFAULT_CALLBACK_MINUTES);
  });

  it("an unrecognised slot does not throw or vanish — it becomes a prompt callback", () => {
    const now = at(1, 12, 0);
    expect(minutesUntil(callbackAt("next Tuesday-ish", now), now)).toBe(DEFAULT_CALLBACK_MINUTES);
    expect(minutesUntil(callbackAt(null, now), now)).toBe(DEFAULT_CALLBACK_MINUTES);
  });

  it("is still clamped into calling hours", () => {
    expect(hhmm(callbackAt("unspecified", at(1, 23, 45)))).toBe("2 11:00");
  });
});

describe("snooze", () => {
  it("two weeks lands on the right day, mid-morning", () => {
    expect(hhmm(snoozeUntil(14, at(1, 16, 42)))).toBe("15 11:00");
  });

  it("aims at a day, not at the minute they tapped", () => {
    expect(hhmm(snoozeUntil(14, at(1, 11, 3)))).toBe("15 11:00");
  });

  it("never lands in the past, whatever it is given", () => {
    const now = at(1, 12, 0);
    for (const d of [0, -5, 0.4]) expect(snoozeUntil(d, now).getTime()).toBeGreaterThan(now.getTime());
  });
});

describe("the hours stay a setting", () => {
  it("a wider window moves the clamp with it", () => {
    const wide = { startHour: 9, endHour: 21 };
    expect(hhmm(clampToCallHours(at(1, 10, 0), wide))).toBe("1 10:00");
    expect(hhmm(clampToCallHours(at(1, 20, 30), wide))).toBe("1 20:30");
  });

  it("'this evening' is honoured when the window is open that late", () => {
    expect(hhmm(callbackAt("this evening", at(1, 12, 0), { startHour: 9, endHour: 21 }))).toBe("1 18:00");
  });
});

describe("minutesUntil", () => {
  it("never returns a negative — a task due in the past is due now", () => {
    expect(minutesUntil(at(1, 12, 0), at(1, 14, 0))).toBe(0);
  });
});
