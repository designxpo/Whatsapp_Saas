// The daily cap exists to keep a number inside Meta's limit. It governed
// broadcasts, the assistant and the public API — and not the drip loop, which
// is the one sender that enrols people in BULK.
//
// A sequence's own maxPerDay paces one contact. It says nothing about a
// thousand contacts each getting their single message the same morning, which
// is precisely what a bulk stage change produces: four leads were moved onto
// "Not Reachable" in the same second on 11 October, and that stage holds
// around a thousand.
//
// The rule these tests pin: a drip send counts against the SAME ceiling as a
// broadcast, and running out defers the step rather than dropping it.
import { describe, it, expect } from "vitest";

/**
 * The loop's accounting, extracted so the rule is testable without standing up
 * the whole cron. Mirrors drainSequences: headroom read once, decremented only
 * by a real WhatsApp send, and a step deferred rather than lost once it is out.
 */
function drain(opts: {
  cap: number;
  sentToday: number;
  due: { platform?: "whatsapp" | "instagram"; outcome: "sent" | "skipped" | "refused" }[];
}): { sent: number; deferred: number; attempted: number } {
  let headroom = Math.max(0, opts.cap - opts.sentToday);
  if (headroom <= 0) return { sent: 0, deferred: opts.due.length, attempted: 0 };

  let sent = 0, deferred = 0, attempted = 0;
  for (const d of opts.due) {
    const isWa = (d.platform ?? "whatsapp") !== "instagram";
    if (isWa && headroom <= 0) { deferred++; continue; }
    attempted++;
    const ok = d.outcome !== "refused";
    if (ok && d.outcome !== "skipped" && isWa) { sent++; headroom--; }
  }
  return { sent, deferred, attempted };
}

const due = (n: number, outcome: "sent" | "skipped" | "refused" = "sent") =>
  Array.from({ length: n }, () => ({ outcome }));

describe("a drip send counts against the same ceiling as a broadcast", () => {
  it("sends only up to the remaining headroom", () => {
    const r = drain({ cap: 900, sentToday: 895, due: due(20) });
    expect(r.sent).toBe(5);
    expect(r.deferred).toBe(15);
  });

  it("the bulk-stage-change case: a thousand due, a cap of 900, nothing lost", () => {
    const r = drain({ cap: 900, sentToday: 0, due: due(1000) });
    expect(r.sent).toBe(900);
    expect(r.deferred).toBe(100);
    expect(r.sent + r.deferred).toBe(1000);   // every lead still accounted for
  });

  it("does not attempt a single send once the cap is already spent", () => {
    // Important beyond the count: not attempting means not calling Meta at
    // all, rather than being refused 900 times and logging 900 failures.
    const r = drain({ cap: 900, sentToday: 900, due: due(50) });
    expect(r).toEqual({ sent: 0, deferred: 50, attempted: 0 });
  });

  it("treats an over-spent counter as zero, not as negative headroom", () => {
    const r = drain({ cap: 900, sentToday: 1200, due: due(5) });
    expect(r.sent).toBe(0);
    expect(r.deferred).toBe(5);
  });
});

describe("what does NOT consume the allowance", () => {
  it("an audience skip", () => {
    // The step advances but no message leaves, so it must not eat headroom
    // that a real lead could have used.
    expect(drain({ cap: 3, sentToday: 0, due: due(10, "skipped") }).sent).toBe(0);
  });

  it("a template refused for a missing token", () => {
    // The {course} case: nothing is sent, so nothing is spent.
    expect(drain({ cap: 3, sentToday: 0, due: due(10, "refused") }).sent).toBe(0);
  });

  it("an Instagram step, which is not on Meta's WhatsApp number limit", () => {
    const r = drain({
      cap: 2, sentToday: 0,
      due: [
        { platform: "instagram", outcome: "sent" },
        { platform: "instagram", outcome: "sent" },
        { platform: "instagram", outcome: "sent" },
        { outcome: "sent" },
      ],
    });
    expect(r.sent).toBe(1);        // only the WhatsApp one counted
    expect(r.deferred).toBe(0);    // and the IG ones were never held back
  });

  it("skips and refusals leave room for the sends behind them", () => {
    const r = drain({
      cap: 2, sentToday: 0,
      due: [{ outcome: "skipped" }, { outcome: "refused" }, { outcome: "sent" }, { outcome: "sent" }],
    });
    expect(r.sent).toBe(2);
    expect(r.deferred).toBe(0);
  });
});

describe("running out defers, it never drops", () => {
  it("every lead is either sent to or deferred — none vanishes", () => {
    for (const n of [1, 7, 100, 1000]) {
      const r = drain({ cap: 50, sentToday: 0, due: due(n) });
      expect(r.sent + r.deferred, `${n} due`).toBe(n);
    }
  });
});
