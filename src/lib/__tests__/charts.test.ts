import { describe, expect, it } from "vitest";
import { barShares, deltaText, indexAtFraction, tableRows, tickIndices, tooltipFor, xFraction, yDomain, type ChartPoint, type ChartSeries } from "@/components/charts";

const series: ChartSeries[] = [
  { key: "sent", label: "Sent", color: "#0783FD", mark: "area" },
  { key: "read", label: "Read", color: "#084FA3", mark: "dashed" },
  { key: "failed", label: "Failed", mark: "none" },
];
const point: ChartPoint = { key: "2026-11-06", label: "6 Nov", values: { sent: 123456, read: 98000, failed: 3 } };

describe("tooltipFor", () => {
  it("gives the date and every series' value, in Indian grouping", () => {
    const t = tooltipFor(point, series);
    expect(t.title).toBe("6 Nov");
    expect(t.rows).toEqual([
      { label: "Sent", value: "1,23,456", color: "#0783FD" },
      { label: "Read", value: "98,000", color: "#084FA3" },
      { label: "Failed", value: "3", color: undefined },
    ]);
    expect(t.text).toBe("6 Nov: Sent 1,23,456, Read 98,000, Failed 3");
  });
  it("prefers the fuller title, and shows a dash for a missing value", () => {
    const t = tooltipFor({ key: "w", label: "3 Nov", title: "Week of 3 Nov", values: { sent: 5 } }, series);
    expect(t.title).toBe("Week of 3 Nov");
    expect(t.rows[1].value).toBe("—");
  });
  it("uses a series' own format", () => {
    const t = tooltipFor({ key: "d", label: "1 Nov", values: { r: 4.5 } }, [{ key: "r", label: "Rating", format: n => `${n.toFixed(1)}★` }]);
    expect(t.text).toBe("1 Nov: Rating 4.5★");
  });
  it("tableRows mirrors the tooltip for each point", () => {
    expect(tableRows([point], series)).toEqual([["6 Nov", "1,23,456", "98,000", "3"]]);
  });
});

describe("axis and cursor maths", () => {
  it("picks at most N ticks, always the first and last", () => {
    expect(tickIndices(0)).toEqual([]);
    expect(tickIndices(4)).toEqual([0, 1, 2, 3]);
    const t = tickIndices(30, 6);
    expect(t.length).toBeLessThanOrEqual(6);
    expect(t[0]).toBe(0);
    expect(t[t.length - 1]).toBe(29);
  });
  it("maps a pointer position to the nearest point", () => {
    expect(indexAtFraction(0, 10)).toBe(0);
    expect(indexAtFraction(1, 10)).toBe(9);
    expect(indexAtFraction(0.5, 11)).toBe(5);
    expect(indexAtFraction(-3, 10)).toBe(0);
    expect(indexAtFraction(7, 10)).toBe(9);
    expect(indexAtFraction(0.4, 1)).toBe(0);
    expect(xFraction(0, 1)).toBe(0.5);
    expect(xFraction(3, 4)).toBe(1);
  });
  it("starts the y axis at zero unless asked to fit", () => {
    expect(yDomain([3, 9])).toEqual({ min: 0, max: 9 });
    expect(yDomain([])).toEqual({ min: 0, max: 1 });
    expect(yDomain([0, 0])).toEqual({ min: 0, max: 1 });
    const fit = yDomain([4.4, 4.6], true);
    expect(fit.min).toBeLessThan(4.4);
    expect(fit.max).toBeGreaterThan(4.6);
    expect(fit.min).toBeGreaterThan(4);
  });
});

describe("deltaText", () => {
  it("says the change in words with an arrow", () => {
    expect(deltaText(12, "%", "previous 7 days")).toEqual({ arrow: "▲", word: "Up", text: "12% vs previous 7 days" });
    expect(deltaText(-3, "points", "previous 15 days")).toEqual({ arrow: "▼", word: "Down", text: "3 points vs previous 15 days" });
    expect(deltaText(-1, "points", "previous 2 weeks").text).toBe("1 point vs previous 2 weeks");
    expect(deltaText(1500, "", "previous 3 months").text).toBe("1,500 vs previous 3 months");
  });
  it("says no change without an arrow", () => {
    expect(deltaText(0, "%", "previous 7 days")).toEqual({ arrow: "", word: "", text: "No change vs previous 7 days" });
  });
});

describe("barShares", () => {
  it("shares of the items' sum, or of a given total", () => {
    expect(barShares([{ label: "a", value: 3 }, { label: "b", value: 1 }])).toEqual([75, 25]);
    expect(barShares([{ label: "a", value: 1 }], 4)).toEqual([25]);
    expect(barShares([{ label: "a", value: 0 }])).toEqual([0]);
  });
});
