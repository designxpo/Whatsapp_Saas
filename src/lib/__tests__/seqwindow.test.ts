// The two rules the RNR follow-up rests on.
//
// A drip that talks over a live conversation, and a drip that greets somebody
// at 3 AM, are the two ways this engine embarrasses the business in front of a
// lead. Both are boundary logic, so both are tested at their boundaries.
import { describe, it, expect } from "vitest";
import {
  withinSendWindow, nextWindowOpening, shouldStopForReply, hasWindow,
  type SendWindow,
} from "@/lib/seqwindow";

const W = (startHour: number | null, endHour: number | null): SendWindow => ({ startHour, endHour });
const at = (h: number, m = 0, d = 15) => new Date(2026, 8, d, h, m, 0, 0);   // 15 Sep 2026, local

describe("withinSendWindow", () => {
  it("no window configured → always allowed (pre-0101 behaviour)", () => {
    expect(hasWindow(W(null, null))).toBe(false);
    for (const h of [0, 3, 9, 13, 23]) expect(withinSendWindow(W(null, null), at(h))).toBe(true);
  });

  it("a half-configured window is treated as no window", () => {
    // The CHECK constraint forbids this, but a pre-migration read could still
    // produce it, and guessing an end hour would be worse than not limiting.
    expect(withinSendWindow(W(10, null), at(3))).toBe(true);
    expect(withinSendWindow(W(null, 20), at(3))).toBe(true);
  });

  it("allows the opening hour exactly", () => {
    expect(withinSendWindow(W(10, 20), at(10, 0))).toBe(true);
  });

  it("allows the last minute before close", () => {
    expect(withinSendWindow(W(10, 20), at(19, 59))).toBe(true);
  });

  it("refuses the closing hour exactly — the range is half-open", () => {
    expect(withinSendWindow(W(10, 20), at(20, 0))).toBe(false);
  });

  it("refuses before opening and after close", () => {
    expect(withinSendWindow(W(10, 20), at(9, 59))).toBe(false);
    expect(withinSendWindow(W(10, 20), at(23, 0))).toBe(false);
    expect(withinSendWindow(W(10, 20), at(3, 0))).toBe(false);
  });

  it("handles the sales window Sabrish asked for (11–17)", () => {
    expect(withinSendWindow(W(11, 17), at(11))).toBe(true);
    expect(withinSendWindow(W(11, 17), at(16, 59))).toBe(true);
    expect(withinSendWindow(W(11, 17), at(17))).toBe(false);
  });
});

describe("nextWindowOpening — deferred, never dropped", () => {
  it("before today's opening → today at the opening hour", () => {
    const d = nextWindowOpening(W(10, 20), at(3, 47));
    expect(d.getDate()).toBe(15);
    expect(d.getHours()).toBe(10);
  });

  it("after today's close → tomorrow at the opening hour", () => {
    const d = nextWindowOpening(W(10, 20), at(21, 30));
    expect(d.getDate()).toBe(16);
    expect(d.getHours()).toBe(10);
  });

  it("zeroes minutes and seconds so a cohort does not land at 19:47:33", () => {
    const d = nextWindowOpening(W(10, 20), at(3, 47));
    expect(d.getMinutes()).toBe(0);
    expect(d.getSeconds()).toBe(0);
    expect(d.getMilliseconds()).toBe(0);
  });

  it("rolls over the end of a month", () => {
    const d = nextWindowOpening(W(10, 20), new Date(2026, 8, 30, 22, 0));  // 30 Sep
    expect(d.getMonth()).toBe(9);    // October
    expect(d.getDate()).toBe(1);
    expect(d.getHours()).toBe(10);
  });

  it("rolls over the end of a year", () => {
    const d = nextWindowOpening(W(10, 20), new Date(2026, 11, 31, 23, 0));
    expect(d.getFullYear()).toBe(2027);
    expect(d.getMonth()).toBe(0);
    expect(d.getDate()).toBe(1);
  });

  it("with no window, returns the moment unchanged", () => {
    const now = at(3);
    expect(nextWindowOpening(W(null, null), now).getTime()).toBe(now.getTime());
  });

  it("the deferred time is itself inside the window", () => {
    // The property that actually matters: whatever we defer to must be sendable.
    const w = W(10, 20);
    for (const h of [0, 5, 9, 20, 21, 23]) {
      expect(withinSendWindow(w, nextWindowOpening(w, at(h)))).toBe(true);
    }
  });
});

describe("shouldStopForReply", () => {
  const mark = "2026-09-15T10:00:00.000Z";

  it("no conversation → do not stop (normal for a lead who never answered)", () => {
    expect(shouldStopForReply(null, mark)).toBe(false);
    expect(shouldStopForReply(undefined, mark)).toBe(false);
  });

  it("stops when the lead replied AFTER the last step", () => {
    expect(shouldStopForReply(
      { lastInboundAt: "2026-09-15T10:00:01.000Z", botEnabled: true, status: "active" }, mark,
    )).toBe(true);
  });

  it("does NOT stop on an inbound that predates the last step", () => {
    expect(shouldStopForReply(
      { lastInboundAt: "2026-09-15T09:59:59.000Z", botEnabled: true, status: "active" }, mark,
    )).toBe(false);
  });

  it("does NOT stop on an inbound with the SAME timestamp as the enrolment", () => {
    // The message that enrolled them can share a timestamp with the enrolment.
    // A >= comparison would kill every keyword-triggered journey at step one.
    expect(shouldStopForReply(
      { lastInboundAt: mark, botEnabled: true, status: "active" }, mark,
    )).toBe(false);
  });

  it("stops when a human turned the bot off", () => {
    expect(shouldStopForReply(
      { lastInboundAt: null, botEnabled: false, status: "active" }, mark,
    )).toBe(true);
  });

  it("stops when the conversation is no longer active", () => {
    expect(shouldStopForReply(
      { lastInboundAt: null, botEnabled: true, status: "closed" }, mark,
    )).toBe(true);
  });

  it("a null status is not a reason to stop", () => {
    expect(shouldStopForReply(
      { lastInboundAt: null, botEnabled: true, status: null }, mark,
    )).toBe(false);
  });

  it("never stops on unparseable timestamps", () => {
    expect(shouldStopForReply(
      { lastInboundAt: "not a date", botEnabled: true, status: "active" }, mark,
    )).toBe(false);
    expect(shouldStopForReply(
      { lastInboundAt: "2026-09-15T10:00:01.000Z", botEnabled: true, status: "active" }, "rubbish",
    )).toBe(false);
  });

  it("no mark yet → cannot compare, so does not stop", () => {
    expect(shouldStopForReply(
      { lastInboundAt: "2026-09-15T10:00:01.000Z", botEnabled: true, status: "active" }, null,
    )).toBe(false);
  });
});
