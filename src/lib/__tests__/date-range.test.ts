import { describe, expect, it } from "vitest";
import {
  RANGE_PRESETS, bucketLabel, customRangeProblem, isoDay, presetByKey, presetDates, presetForDays, presetOptions, previousWindow,
} from "../analytics-range";
import { nextIndex } from "@/components/date-range";

describe("range presets", () => {
  it("each screen gets only the presets it asks for, in one fixed order", () => {
    expect(presetOptions(["all", "7d", "90d", "30d"]).map(p => p.key)).toEqual(["7d", "30d", "90d", "all"]);
    expect(presetOptions(["90d", "24h", "7d", "30d"]).map(p => p.key)).toEqual(["24h", "7d", "30d", "90d"]);
    expect(presetOptions(["custom", "12m", "7d"]).map(p => p.key)).toEqual(["7d", "12m", "custom"]);
  });
  it("uses the same words everywhere, and the short name is part of the full one", () => {
    expect(presetByKey("30d")?.label).toBe("Last 30 days");
    expect(presetByKey("12m")?.label).toBe("Last 12 months");
    for (const p of RANGE_PRESETS) expect(p.label).toContain(p.short === "Custom" ? "Custom" : p.short);
  });
  it("names Team Progress's one-day window for what it counts (a rolling 24 hours)", () => {
    expect(presetForDays(1, ["24h", "7d", "30d", "90d"])?.label).toBe("Last 24 hours");
  });
  it("maps day counts back to presets, only among the offered ones", () => {
    expect(presetForDays(30)?.key).toBe("30d");
    expect(presetForDays(365, ["7d", "30d"])).toBeUndefined();
    expect(presetForDays(14)).toBeUndefined();
  });
});

describe("presetDates", () => {
  it("is inclusive of today", () => {
    const now = new Date(2026, 10, 6, 15);
    expect(presetDates(7, now)).toEqual({ from: "2026-10-31", to: "2026-11-06" });
    expect(presetDates(1, now)).toEqual({ from: "2026-11-06", to: "2026-11-06" });
  });
  it("crosses a year", () => {
    expect(presetDates(30, new Date(2026, 0, 10))).toEqual({ from: "2025-12-12", to: "2026-01-10" });
  });
  it("isoDay uses the local calendar day", () => {
    expect(isoDay(new Date(2026, 1, 3, 23, 59))).toBe("2026-02-03");
  });
});

describe("customRangeProblem", () => {
  it("accepts a valid period", () => {
    expect(customRangeProblem("2026-10-01", "2026-10-31", { maxDays: 366, today: "2026-11-06" })).toBeNull();
  });
  it("explains each problem in words", () => {
    expect(customRangeProblem("", "2026-10-31")).toMatch(/both a start and an end/);
    expect(customRangeProblem("2026-11-02", "2026-11-01")).toMatch(/start date is after the end date/);
    expect(customRangeProblem("2026-11-01", "2026-11-09", { today: "2026-11-06" })).toMatch(/future/);
    expect(customRangeProblem("2025-01-01", "2026-11-01", { maxDays: 366 })).toBe("Choose a period of a year or less.");
    expect(customRangeProblem("2026-01-01", "2026-03-01", { maxDays: 31 })).toBe("Choose a period of 31 days or less.");
  });
  it("allows exactly the maximum", () => {
    expect(customRangeProblem("2026-01-01", "2026-01-31", { maxDays: 31 })).toBeNull();
  });
});

describe("bucketLabel", () => {
  const now = new Date(2026, 10, 6);
  it("days, weeks and months read in Indian order", () => {
    expect(bucketLabel("2026-11-06", "day", { now })).toBe("6 Nov");
    expect(bucketLabel("2026-11-02", "week", { now })).toBe("Week of 2 Nov");
    expect(bucketLabel("2026-11", "month", { now })).toBe("Nov 2026");
  });
  it("adds the year when it isn't this year, or when asked", () => {
    expect(bucketLabel("2025-12-30", "day", { now })).toBe("30 Dec 2025");
    expect(bucketLabel("2026-11-06", "day", { now, withYear: true })).toBe("6 Nov 2026");
  });
  it("passes unknown keys through", () => {
    expect(bucketLabel("weird", "day")).toBe("weird");
  });
  it("previousWindow names the comparison", () => {
    expect(previousWindow(15, "day")).toBe("previous 15 days");
    expect(previousWindow(1, "week")).toBe("previous 1 week");
    expect(previousWindow(4, "month")).toBe("previous 4 months");
  });
});

describe("radio-group keys", () => {
  it("arrows move and wrap; Home/End jump; other keys do nothing", () => {
    expect(nextIndex("ArrowRight", 0, 4)).toBe(1);
    expect(nextIndex("ArrowDown", 3, 4)).toBe(0);
    expect(nextIndex("ArrowLeft", 0, 4)).toBe(3);
    expect(nextIndex("ArrowUp", 2, 4)).toBe(1);
    expect(nextIndex("Home", 2, 4)).toBe(0);
    expect(nextIndex("End", 0, 4)).toBe(3);
    expect(nextIndex("Enter", 1, 4)).toBeNull();
    expect(nextIndex("ArrowRight", 0, 0)).toBeNull();
  });
});
