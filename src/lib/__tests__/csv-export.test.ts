import { describe, expect, it } from "vitest";
import { BOM, csvCell, csvDate, csvFileName, csvRupees, toCsv, toCsvSections } from "../csv-export";

describe("csvCell", () => {
  it("quotes text and doubles quotes inside it", () => {
    expect(csvCell("Asha")).toBe('"Asha"');
    expect(csvCell('He said "hi"')).toBe('"He said ""hi"""');
    expect(csvCell("a,b\nc")).toBe('"a,b\nc"');
  });
  it("keeps numbers as bare numbers so they still add up", () => {
    expect(csvCell(123456)).toBe("123456");
    expect(csvCell(-4)).toBe("-4");          // a negative number is not a formula
    expect(csvCell(12.5)).toBe("12.5");
    expect(csvCell(NaN)).toBe("");
    expect(csvCell(Infinity)).toBe("");
  });
  it("defuses text that a spreadsheet would run as a formula", () => {
    expect(csvCell("=SUM(A1)")).toBe(`"'=SUM(A1)"`);
    expect(csvCell("+91 98100")).toBe(`"'+91 98100"`);
    expect(csvCell("-x")).toBe(`"'-x"`);
    expect(csvCell("@cmd")).toBe(`"'@cmd"`);
  });
  it("writes empty for null/undefined and words for booleans", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(true)).toBe("Yes");
    expect(csvCell(false)).toBe("No");
  });
  it("keeps non-English text intact", () => {
    expect(csvCell("प्रिया ₹")).toBe('"प्रिया ₹"');
  });
});

describe("toCsv", () => {
  it("starts with a BOM (so Excel reads UTF-8) and ends rows with CRLF", () => {
    const out = toCsv(["Date", "Sent"], [["6 Nov 2026", 64], ["7 Nov 2026", 0]]);
    expect(out.startsWith(BOM)).toBe(true);
    expect(out.slice(1)).toBe('"Date","Sent"\r\n"6 Nov 2026",64\r\n"7 Nov 2026",0\r\n');
  });
  it("can leave the BOM out", () => {
    expect(toCsv(["A"], [], { bom: false })).toBe('"A"\r\n');
  });
});

describe("toCsvSections", () => {
  it("puts each table under its title with a blank line between", () => {
    const out = toCsvSections([
      { title: "Summary", header: ["Measure", "Value"], rows: [["Orders", 3]] },
      { header: ["Ad", "Leads"], rows: [] },
    ], { bom: false });
    expect(out).toBe('"Summary"\r\n"Measure","Value"\r\n"Orders",3\r\n\r\n"Ad","Leads"\r\n');
  });
});

describe("csvDate", () => {
  it("writes Indian day-month order with the month in words", () => {
    expect(csvDate("2026-11-06")).toBe("6 Nov 2026");
    expect(csvDate("2026-01-31")).toBe("31 Jan 2026");
  });
  it("takes a calendar day as-is, whatever the time zone", () => {
    expect(csvDate("2026-03-01")).toBe("1 Mar 2026");
  });
  it("handles full timestamps and junk", () => {
    expect(csvDate(new Date(2026, 10, 6, 15, 30).toISOString())).toBe("6 Nov 2026");
    expect(csvDate("")).toBe("");
    expect(csvDate(null)).toBe("");
    expect(csvDate("not a date")).toBe("");
  });
});

describe("csvRupees and csvFileName", () => {
  it("turns paise into rupees as a plain number", () => {
    expect(csvRupees(1245050000)).toBe(12450500);
    expect(csvRupees(12345)).toBe(123.45);
    expect(csvRupees(null)).toBeNull();
  });
  it("makes a tidy file name with today's date", () => {
    expect(csvFileName(["analytics", "Last 30 days"], new Date(2026, 10, 6))).toBe("talko-analytics-last-30-days-2026-11-06.csv");
    expect(csvFileName(["team progress", "All teams!"], new Date(2026, 0, 2))).toBe("talko-team-progress-all-teams-2026-01-02.csv");
  });
});
