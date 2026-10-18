// Date windows for the dashboard.
//
// Everything was hard-wired to 14 days: getAnalytics built exactly 14 daily
// buckets, cards were titled "last 14 days", and the payload carried fields
// literally named replied14d / aiReplies14d / new14d. There was no way to ask
// "how has this done since we launched", and two places downstream silently
// assumed the 14-bucket shape — the week-over-week comparison sliced [0,7) vs
// [7,), which means nothing once the series is any other length.
//
// The interesting part is "all time", where the naive answer — drop the lower
// bound and keep one bucket per day — draws a chart with a bar per day since the
// account was created. So bucket size has to follow the span, and these tests
// pin where it changes.
import { describe, it, expect } from "vitest";
import {
  RANGES, DEFAULT_RANGE, isRangeKey, parseRange, rangeDays, rangeShort, rangeStart,
  granularityFor, bucketKey, bucketKeys,
} from "../analytics-range";

describe("range definitions", () => {
  it("offers a lifetime option, which is the one that was missing", () => {
    const all = RANGES.find(r => r.key === "all");
    expect(all).toBeTruthy();
    // null, not a very large number: the query drops its lower bound entirely
    // rather than clamping to some arbitrary old date, which would still be a lie.
    expect(all!.days).toBeNull();
    expect(rangeDays("all")).toBeNull();
  });

  it("keeps a sane default rather than the old hard-coded 14 days", () => {
    expect(DEFAULT_RANGE).toBe("30d");
    expect(rangeDays(DEFAULT_RANGE)).toBe(30);
  });

  it("falls back instead of throwing on anything unrecognised", () => {
    // A stale bookmark or a client from another build must still get a dashboard.
    expect(parseRange("nonsense")).toBe(DEFAULT_RANGE);
    expect(parseRange(null)).toBe(DEFAULT_RANGE);
    expect(parseRange(undefined)).toBe(DEFAULT_RANGE);
    expect(parseRange("90d")).toBe("90d");
    expect(isRangeKey("14d")).toBe(true);
    expect(isRangeKey("13d")).toBe(false);
  });

  it("reads naturally mid-sentence, including for lifetime", () => {
    expect(rangeShort("30d")).toBe("last 30 days");
    expect(rangeShort("all")).toBe("all time");
  });
});

describe("rangeStart", () => {
  const now = new Date("2026-09-01T15:30:00Z");

  it("is inclusive of today, so '7 days' spans 7 days and not 8", () => {
    const from = rangeStart("7d", now)!;
    expect(from.toISOString().slice(0, 10)).toBe("2026-08-26");
    // Counted in calendar days, which is what "7 days" means to a reader —
    // elapsed milliseconds would say 6.65 and round either way depending on the
    // time of day the dashboard happened to be opened.
    const todayUtc = Date.parse(now.toISOString().slice(0, 10));
    expect((todayUtc - from.getTime()) / 86400_000 + 1).toBe(7);
  });

  it("starts at a UTC day boundary, matching how bucket keys are derived", () => {
    // Not local midnight: bucketKey() slices the UTC ISO string off sent_at, so
    // building boundaries in local time put the two 5.5h apart on this account
    // and messages either side of local midnight fell into a bucket the window
    // had never generated.
    const from = rangeStart("30d", now)!;
    expect(from.getUTCHours()).toBe(0);
    expect(from.getUTCMinutes()).toBe(0);
    expect(from.toISOString()).toBe("2026-08-03T00:00:00.000Z");
  });

  it("has no lower bound at all for lifetime", () => {
    expect(rangeStart("all", now)).toBeNull();
  });
});

describe("bucket sizing", () => {
  it("switches off daily buckets before a chart becomes unreadable", () => {
    // The whole reason "all time" needed thought: a bar per day over three years
    // is a thousand bars.
    expect(granularityFor(1)).toBe("day");
    expect(granularityFor(30)).toBe("day");
    expect(granularityFor(35)).toBe("day");
    expect(granularityFor(36)).toBe("week");
    expect(granularityFor(280)).toBe("week");
    expect(granularityFor(281)).toBe("month");
    expect(granularityFor(3650)).toBe("month");
  });

  it("keeps every range's bucket count small enough to render", () => {
    const now = new Date("2026-09-01T12:00:00Z");
    for (const r of RANGES) {
      if (r.days === null) continue;
      const from = rangeStart(r.key, now)!;
      const keys = bucketKeys(from, now, granularityFor(r.days));
      expect(keys.length).toBeGreaterThan(0);
      expect(keys.length).toBeLessThanOrEqual(35);
    }
  });

  it("caps a decade of lifetime data at a readable number of bars", () => {
    const now = new Date("2026-09-01T12:00:00Z");
    const from = new Date("2016-09-01T12:00:00Z");
    const keys = bucketKeys(from, now, granularityFor(3653));
    expect(keys.length).toBeLessThan(130);      // ~121 months
  });
});

describe("bucketKey", () => {
  it("buckets a day by its date", () => {
    expect(bucketKey("2026-09-01T15:30:00Z", "day")).toBe("2026-09-01");
  });

  it("buckets a month by year-month", () => {
    expect(bucketKey("2026-09-01T15:30:00Z", "month")).toBe("2026-09");
  });

  it("buckets a week by its MONDAY, so every day of that week agrees", () => {
    // 2026-09-01 is a Tuesday; its Monday is 2026-08-31.
    const mon = bucketKey("2026-08-31T00:00:00Z", "week");
    expect(mon).toBe("2026-08-31");
    for (const d of ["2026-08-31", "2026-09-01", "2026-09-04", "2026-09-06"]) {
      expect(bucketKey(`${d}T09:00:00Z`, "week")).toBe(mon);
    }
    // Sunday is the END of that week, not the start of the next.
    expect(bucketKey("2026-09-06T23:59:00Z", "week")).toBe(mon);
    expect(bucketKey("2026-09-07T00:00:00Z", "week")).toBe("2026-09-07");
  });
});

describe("bucketKeys", () => {
  it("includes empty buckets, so a quiet day doesn't shift the bars left", () => {
    const keys = bucketKeys(new Date("2026-08-30T12:00:00Z"), new Date("2026-09-01T12:00:00Z"), "day");
    expect(keys).toEqual(["2026-08-30", "2026-08-31", "2026-09-01"]);
  });

  it("returns each bucket once, in order", () => {
    const keys = bucketKeys(new Date("2026-08-01T12:00:00Z"), new Date("2026-09-01T12:00:00Z"), "week");
    expect(new Set(keys).size).toBe(keys.length);
    expect([...keys]).toEqual([...keys].sort());
  });

  it("terminates on an absurd span rather than spinning", () => {
    // A corrupt oldest-timestamp reaches this from getAnalytics' "all time" path.
    const keys = bucketKeys(new Date("1900-01-01T12:00:00Z"), new Date("2026-09-01T12:00:00Z"), "day");
    expect(keys.length).toBeLessThanOrEqual(4000);
  });
});
