// The drip conversation, as it will appear on the lead in LeadSquared.
//
// The trimming is what these mostly test. A log that grows past the field's
// MaxLength is accepted with HTTP 200 and stored as nothing — so overflowing
// loses EVERYTHING, which is far worse than losing the oldest line.
import { describe, it, expect } from "vitest";
import {
  dripLine, appendDripLine, sendLine, replyLine, stamp, humaniseTemplate, TRIM_MARK, DRIP_LOG_MAX, replyMaxText,
} from "@/lib/driplog";

const T = (d: number, h: number, m: number) => new Date(2026, 9, d, h, m);

describe("a line", () => {
  it("reads as date, direction, what happened", () => {
    expect(dripLine(T(2, 11, 30), "out", "R+1 about us")).toBe("02Oct 11:30 → R+1 about us");
  });

  it("uses the arrow to say who spoke", () => {
    expect(dripLine(T(2, 11, 30), "in", "Request a callback")).toBe("02Oct 11:30 ← Request a callback");
  });

  it("pads so the lines align when stacked", () => {
    expect(stamp(T(2, 9, 5))).toBe("02Oct 09:05");
  });

  it("flattens newlines — one event, one line", () => {
    expect(dripLine(T(2, 11, 30), "in", "hello\n\nthere  friend")).toBe("02Oct 11:30 ← hello there friend");
  });
});

describe("appending", () => {
  it("adds to the end, newest last", () => {
    const a = appendDripLine("", sendLine(T(1, 10, 0), "R+1 about us"), 1000);
    const b = appendDripLine(a, replyLine(T(1, 11, 0), "Request a callback"), 1000);
    expect(b.split("\n")).toEqual([
      "01Oct 10:00 → R+1 about us",
      "01Oct 11:00 ← Request a callback",
    ]);
  });

  it("ignores an empty line rather than adding a blank row", () => {
    expect(appendDripLine("01Oct 10:00 → x", "   ", 1000)).toBe("01Oct 10:00 → x");
  });

  it("starts cleanly from nothing", () => {
    expect(appendDripLine("", "01Oct 10:00 → x", 1000)).toBe("01Oct 10:00 → x");
  });
});

describe("staying inside the field", () => {
  it("never exceeds the limit, however many lines are added", () => {
    let log = "";
    for (let i = 1; i <= 40; i++) log = appendDripLine(log, dripLine(T(i % 28 + 1, 10, 0), "out", `step ${i}`), 256);
    expect(log.length).toBeLessThanOrEqual(256);
  });

  it("drops the OLDEST lines, keeping what just happened", () => {
    let log = "";
    for (let i = 1; i <= 20; i++) log = appendDripLine(log, dripLine(T(1, 10, i), "out", `line ${i}`), 256);
    expect(log).toContain("line 20");
    expect(log).not.toContain("line 1\n");
  });

  it("marks that something was dropped, so the log does not look complete", () => {
    let log = "";
    for (let i = 1; i <= 20; i++) log = appendDripLine(log, dripLine(T(1, 10, i), "out", `line ${i}`), 256);
    expect(log.startsWith(TRIM_MARK)).toBe(true);
  });

  it("does not mark anything while nothing has been dropped", () => {
    const log = appendDripLine(appendDripLine("", "01Oct 10:00 → a", 1000), "01Oct 10:01 → b", 1000);
    expect(log).not.toContain(TRIM_MARK);
  });

  it("does not accumulate trim marks", () => {
    let log = "";
    for (let i = 1; i <= 40; i++) log = appendDripLine(log, dripLine(T(1, 10, i % 60), "out", `line ${i}`), 256);
    expect(log.split(TRIM_MARK).length - 1).toBe(1);
  });

  it("hard-cuts a single line longer than the whole field", () => {
    // Something is better than a gap where the lead's reply was.
    const huge = "01Oct 10:00 ← " + "x".repeat(500);
    const log = appendDripLine("01Oct 09:00 → earlier", huge, 256);
    expect(log.length).toBe(256);
    expect(log.startsWith("01Oct 10:00 ←")).toBe(true);
  });
});

describe("a typed reply does not eat the whole field", () => {
  it("is cut, so the history it sits in survives", () => {
    const long = "I would like to know the complete fee structure including EMI options and whether there is any scholarship available for working professionals";
    // The ceiling was a hard-coded 60, asserted here as a magic "< 90".
    // Right while the field held 256; wrong once it held 1,000, where it was
    // cutting a 69-character sentence mid-word. The budget now derives from
    // the field, so this asserts the INTENT — a single reply leaves room for
    // the ones around it — rather than yesterday's number.
    const line = replyLine(T(1, 10, 0), long);
    const body = line.replace("01Oct 10:00 ← ", "");
    expect(body.length).toBeLessThanOrEqual(replyMaxText());
    expect(line.length).toBeLessThan(DRIP_LOG_MAX);
    expect(line).toContain("01Oct 10:00 ←");
  });

  it("a tap goes in whole — they are already short", () => {
    expect(replyLine(T(1, 10, 0), "Request a callback")).toBe("01Oct 10:00 ← Request a callback");
  });
});

describe("the real four-week journey fits", () => {
  // Seven sends and seven replies is the worst realistic case. At 256 it
  // will be trimmed; at 1000 it should survive whole, which is the argument
  // for raising the field.
  const build = (max: number) => {
    let log = "";
    const steps = ["R+1 about us", "R+2 course", "R+5 masterclass", "R+10 results", "R+15 centre", "R+21 batch", "R+28 keep or close"];
    steps.forEach((s, i) => {
      log = appendDripLine(log, sendLine(T(i + 1, 10, 0), s), max);
      log = appendDripLine(log, replyLine(T(i + 1, 11, 0), "Request a callback"), max);
    });
    return log;
  };

  it("at 256 it keeps the recent end and says it trimmed", () => {
    const log = build(256);
    expect(log.length).toBeLessThanOrEqual(256);
    expect(log).toContain("R+28 keep or close");
    expect(log.startsWith(TRIM_MARK)).toBe(true);
  });

  it("at 1000 the whole conversation survives", () => {
    const log = build(1000);
    expect(log.length).toBeLessThanOrEqual(1000);
    expect(log).toContain("R+1 about us");
    expect(log).toContain("R+28 keep or close");
    expect(log).not.toContain(TRIM_MARK);
  });
});

describe("the default limit", () => {
  it("is the field's MaxLength as it stands today", () => {
    expect(DRIP_LOG_MAX).toBe(256);
  });
});

describe("humaniseTemplate", () => {
  // The template name is ours. A counsellor reading the lead's log should
  // see what was said, not our file-naming convention.
  it("strips the rnr_NN_ prefix from the real names", () => {
    expect(humaniseTemplate("rnr_03_about_us")).toBe("about us");
    expect(humaniseTemplate("rnr_07_centre_visit")).toBe("centre visit");
    expect(humaniseTemplate("rnr_09_keep_or_close")).toBe("keep or close");
  });

  it("leaves a name that does not follow the convention alone", () => {
    expect(humaniseTemplate("welcome_offer")).toBe("welcome offer");
  });

  it("never returns an empty label", () => {
    expect(humaniseTemplate("")).toBe("message");
    expect(humaniseTemplate("   ")).toBe("message");
  });

  it("the real nine all fit a log line comfortably", () => {
    for (const n of ["rnr_01_missed_call", "rnr_02_call_retry", "rnr_03_about_us",
                     "rnr_04_course_roles", "rnr_05_masterclass", "rnr_06_results",
                     "rnr_07_centre_visit", "rnr_08_next_batch", "rnr_09_keep_or_close"]) {
      expect(sendLine(T(1, 10, 0), humaniseTemplate(n)).length).toBeLessThan(40);
    }
  });
});
