// Reading tables, and lifting the numbers out of them.
//
// The real fee data is tabular — a programme down the side, a delivery mode
// across the top, a rupee figure in each cell. In prose those numbers are
// unverifiable: an answer saying "around 80,000" cannot be checked against
// anything. As typed front-matter fields they can, which is what turns
// "probably grounded" into "grounded or not".
//
// Indian notation throughout. "INR 1,08,560/-" is one lakh eight thousand five
// hundred and sixty, and a parser that reads it Western-style gets a number
// that is wrong by an order of magnitude while still looking plausible.
import { describe, it, expect } from "vitest";
import { parseTables, parseMoney, tableFacts, factsFor } from "@/lib/okffacts";

describe("reading a markdown table", () => {
  const md = [
    "Our fees:", "",
    "| Mode | Fee (incl. taxes) |",
    "|---|---|",
    "| Classroom Sessions | INR 41,300/- |",
    "| Blended eLearning | INR 33,040/- |",
    "", "Conditions apply.",
  ].join("\n");

  it("finds the table and its headers", () => {
    const [t] = parseTables(md);
    expect(t.headers).toEqual(["Mode", "Fee (incl. taxes)"]);
  });

  it("reads every row", () => {
    expect(parseTables(md)[0].rows).toEqual([
      ["Classroom Sessions", "INR 41,300/-"],
      ["Blended eLearning", "INR 33,040/-"],
    ]);
  });

  it("ignores the separator row rather than treating it as data", () => {
    expect(parseTables(md)[0].rows.some(r => r[0].includes("---"))).toBe(false);
  });

  it("strips the bold markers the exports wrap programme names in", () => {
    const t = parseTables("| A | B |\n|---|---|\n| **Analytics Edge** | x |")[0];
    expect(t.rows[0][0]).toBe("Analytics Edge");
  });

  it("finds several tables in one document", () => {
    expect(parseTables(md + "\n\n| City | Address |\n|---|---|\n| Noida | Sector 2 |")).toHaveLength(2);
  });

  it("returns nothing for prose", () => {
    expect(parseTables("Just a paragraph. No pipes here.")).toEqual([]);
  });

  it("is not fooled by a single stray pipe in a sentence", () => {
    expect(parseTables("Use the | character carefully.")).toEqual([]);
  });

  it("keeps a row whose cells are uneven rather than dropping the row", () => {
    const t = parseTables("| A | B | C |\n|---|---|---|\n| one | two |")[0];
    expect(t.rows[0]).toEqual(["one", "two", ""]);
  });
});

describe("parsing money the way it is actually written here", () => {
  it("reads Indian lakh grouping", () => {
    // 1,08,560 is 108560. Read Western-style it is still a number, still
    // plausible, and wrong by a factor of ten.
    expect(parseMoney("INR 1,08,560/-")).toBe(108560);
  });

  it("reads the plain forms", () => {
    expect(parseMoney("INR 41,300/-")).toBe(41300);
    expect(parseMoney("₹85,000")).toBe(85000);
    expect(parseMoney("Rs. 70,800")).toBe(70800);
    expect(parseMoney("33040")).toBe(33040);
  });

  it("reads lakh and LPA as words", () => {
    expect(parseMoney("₹6 lakh")).toBe(600000);
    expect(parseMoney("10 LPA")).toBe(1000000);
    expect(parseMoney("3.5 lakh")).toBe(350000);
  });

  it("refuses anything that is not a figure", () => {
    expect(parseMoney("Not Offered")).toBeNull();
    expect(parseMoney("")).toBeNull();
    expect(parseMoney("—")).toBeNull();
  });

  it("does not mistake a year or a small count for a price", () => {
    expect(parseMoney("2026")).toBeNull();
    expect(parseMoney("6 months")).toBeNull();
  });
});

describe("lifting prices out of a fee table", () => {
  const wide = [
    "| Program | Classroom Mode | Interactive Live Online | Blended eLearning |",
    "|---|---|---|---|",
    "| **Adv. Cert. in Data Analytics & AI** | INR 87,320/- | INR 80,240/- | INR 70,800/- |",
    "| **Full Stack AI Training Program** | *Not Offered* | INR 80,240/- | INR 70,800/- |",
  ].join("\n");

  it("gives every programme its own set of prices", () => {
    const f = tableFacts(parseTables(wide)[0]);
    expect(f.find(x => x.subject === "Adv. Cert. in Data Analytics & AI")?.prices).toEqual({
      "classroom-mode": 87320, "interactive-live-online": 80240, "blended-elearning": 70800,
    });
  });

  it("leaves out a mode that is not offered, rather than recording zero", () => {
    // A zero here reads as "free" to anything downstream.
    const f = tableFacts(parseTables(wide)[0]);
    const fs = f.find(x => x.subject === "Full Stack AI Training Program")!;
    expect(fs.prices["classroom-mode"]).toBeUndefined();
    expect(fs.prices["blended-elearning"]).toBe(70800);
  });

  it("will not price a two-column table with no subject to attach it to", () => {
    // This used to treat the delivery MODE as the subject, which is how three
    // different courses' tables all came to claim "Blended eLearning" and
    // disagree with one another in the mismatch report. The caller supplies
    // the course now, or there is no fact.
    const narrow = "| Mode | Fee (incl. taxes) |\n|---|---|\n| Classroom Sessions | INR 41,300/- |";
    expect(tableFacts(parseTables(narrow)[0])).toEqual([]);
    expect(tableFacts(parseTables(narrow)[0], { subject: "Analytics Edge" })[0].prices["classroom-sessions"]).toBe(41300);
  });

  it("ignores a table with no money in it", () => {
    const addr = "| City | Address |\n|---|---|\n| Noida | Sector 2 |";
    expect(tableFacts(parseTables(addr)[0])).toEqual([]);
  });
});

describe("the front matter a concept ends up carrying", () => {
  const body = [
    "## Fees",
    "",
    "| Program | Classroom Mode | Blended eLearning |",
    "|---|---|---|",
    "| **Adv. Cert. in Data Analytics & AI** | INR 87,320/- | INR 70,800/- |",
    "",
    "The course runs 6 months with 90% placement support.",
  ].join("\n");

  it("records the prices as fields, not as prose", () => {
    const f = factsFor(body);
    expect(f.price_min_inr).toBe("70800");
    expect(f.price_max_inr).toBe("87320");
  });

  it("records the duration and the headline percentage", () => {
    const f = factsFor(body);
    expect(f.duration_months).toBe("6");
    expect(f.placement_pct).toBe("90");
  });

  it("names which programmes the prices belong to", () => {
    expect(factsFor(body).priced_subjects).toContain("Adv. Cert. in Data Analytics & AI");
  });

  it("writes nothing at all when there is nothing to write", () => {
    expect(factsFor("Just some prose about our friendly team.")).toEqual({});
  });

  it("reads prices stated in a sentence, not only in a table", () => {
    expect(factsFor("The programme fee is ₹85,000 including taxes.").price_min_inr).toBe("85000");
  });

  it("does not record a placement figure from an unrelated percentage", () => {
    // "20% discount" is not a placement rate.
    expect(factsFor("Get a 20% discount this month.").placement_pct).toBeUndefined();
  });
});

describe("a table whose rows are modes, not programmes", () => {
  // The brochure states fees as "| Mode | Fee |", so the row names a delivery
  // mode and nothing in the table says which course it is for. The course is
  // in the heading above it. Without that, the brochure's prices were never
  // cross-checked against anything — and the brochure is the source most
  // likely to go stale.
  const narrow = [
    "| Mode | Fee (incl. taxes) |",
    "|---|---|",
    "| Classroom Sessions | INR 41,300/- |",
    "| Blended eLearning | INR 33,040/- |",
  ].join("\n");

  it("uses the heading as the subject when the table has none", () => {
    const f = tableFacts(parseTables(narrow)[0], { subject: "Analytics Edge" });
    expect(f).toHaveLength(1);
    expect(f[0].subject).toBe("Analytics Edge");
  });

  it("turns each row into a column of that one subject", () => {
    const f = tableFacts(parseTables(narrow)[0], { subject: "Analytics Edge" });
    expect(f[0].prices).toEqual({ "classroom-sessions": 41300, "blended-elearning": 33040 });
  });

  it("ignores the offered subject when the table names programmes itself", () => {
    const wide = "| Program | Classroom |\n|---|---|\n| **Full Stack AI** | INR 70,800/- |";
    const f = tableFacts(parseTables(wide)[0], { subject: "Something else" });
    expect(f[0].subject).toBe("Full Stack AI");
  });

  it("still yields nothing without a subject to attach the rows to", () => {
    // Better no fact than a price belonging to an unknown course.
    expect(tableFacts(parseTables(narrow)[0])).toEqual([]);
  });
});
