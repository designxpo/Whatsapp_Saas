import { describe, it, expect } from "vitest";
import { parseCsvText, mapCsvRows, normalisePhone } from "../csv-import";

// Fixture: the real LMS "Student List" export. Every quirk below is from the
// actual file — mixed phone formats, a leading-space name, a Batch Name column,
// and a dozen course/payment columns.
const HEAD = "Product Name,Batch Name,Name,Student Email,Student Phone,User Blocked,Course Blocked,Blocked By Payment,Reg. Type,Reg. Mode,Payment Status,IIT-P,SQL,Power BI,Data Visualization & Analytics";
const CSV = [
  HEAD,
  "Adv. Cert. in Data Analytics & AI,BT DVA (NOI) AUG 2026,GURVANSH SINGH,vansh3953@gmail.com,+91-8459602964,FALSE,FALSE,FALSE,Old,Offline,Due,No,not submitted,not submitted,Not appeared",
  "Adv. Cert. in Data Analytics & AI,BT DVA (NOI) AUG 2026,Ishu Paswan,radhe11632@gmail.com,9289311196,FALSE,FALSE,FALSE,New,Offline,Due,No,not submitted,not submitted,Not appeared",
  "Adv. Cert. in Data Analytics & AI,BT DVA (NOI) AUG 2026, Abhin santhosh,eabhin2002@gmail.com,8590536437,FALSE,FALSE,FALSE,New,Online,Due,No,not submitted,not submitted,Not appeared",
  "Executive Certif. in Data Science with AI Spec & GenAI,BT DVA (NOI) AUG 2026,Shubham,shubhamjhanjhot333k@gmail.com,9034780755,TRUE,FALSE,FALSE,New,Offline,Due,Yes,not submitted,not submitted,Not appeared",
].join("\n");

describe("student-list CSV import", () => {
  const { rows, mapping } = mapCsvRows(parseCsvText(CSV));

  it("imports every row — previously it imported NONE", () => {
    // "Student Phone" wasn't a recognised header, so the phone index fell back
    // to column 0 ("Product Name"), looksLikePhone rejected it, and the whole
    // file filtered down to zero contacts.
    expect(rows.length).toBe(4);
  });

  it("maps the student columns to real fields, not attributes", () => {
    expect(mapping).toContain('phone ← "Student Phone"');
    expect(mapping).toContain('name ← "Name"');
    expect(mapping).toContain('email ← "Student Email"');
    expect(mapping).toContain('batch ← "Batch Name"');
    expect(rows[0].name).toBe("GURVANSH SINGH");
    expect(rows[0].email).toBe("vansh3953@gmail.com");
  });

  it("adds the country code to bare 10-digit numbers", () => {
    // Stored as 10 digits, Meta cannot route it and every send fails.
    expect(rows[1].phone).toBe("919289311196");
    expect(rows[2].phone).toBe("918590536437");
  });

  it("leaves an already-international number alone", () => {
    expect(rows[0].phone).toBe("918459602964");   // from "+91-8459602964"
  });

  it("reads the batch name off every row", () => {
    expect(new Set(rows.map(r => r.batchName))).toEqual(new Set(["BT DVA (NOI) AUG 2026"]));
  });

  it("flags a blocked student and leaves the rest unflagged", () => {
    expect(rows[3].blocked).toBe(true);           // User Blocked = TRUE
    expect(rows[0].blocked).toBeUndefined();
  });

  it("trims a name with a leading space", () => {
    expect(rows[2].name).toBe("Abhin santhosh");
  });

  it("keeps the course/payment columns as attributes", () => {
    expect(rows[0].attributes).toMatchObject({
      "Product Name": "Adv. Cert. in Data Analytics & AI",
      "Reg. Type": "Old", "Reg. Mode": "Offline", "Payment Status": "Due",
      "Data Visualization & Analytics": "Not appeared",
    });
    // The batch column is a field now, so it must not ALSO be an attribute.
    expect(rows[0].attributes?.["Batch Name"]).toBeUndefined();
  });
});

describe("normalisePhone", () => {
  it("prefixes a 10-digit national number", () => {
    expect(normalisePhone("9289311196")).toBe("919289311196");
  });
  it("strips a domestic trunk 0", () => {
    expect(normalisePhone("09289311196")).toBe("919289311196");
    expect(normalisePhone("0919289311196")).toBe("919289311196");
  });
  it("passes an already-prefixed number through untouched", () => {
    expect(normalisePhone("+91 92893 11196")).toBe("919289311196");
    expect(normalisePhone("919289311196")).toBe("919289311196");
  });
  it("honours a different default country code", () => {
    expect(normalisePhone("5551234567", "1")).toBe("15551234567");
  });
  it("does not invent digits for junk or empty input", () => {
    expect(normalisePhone("")).toBe("");
    expect(normalisePhone("abc")).toBe("");
    // Too short to be a national number — left as-is so the row is rejected
    // downstream rather than silently turned into a plausible-looking number.
    expect(normalisePhone("12345")).toBe("12345");
  });
});

describe("regression: ordinary contact CSVs still work", () => {
  it("handles a simple phone,name,tags file with no batch column", () => {
    const { rows, mapping } = mapCsvRows(parseCsvText("phone,name,tags\n919812345678,Asha,vip;june"));
    expect(rows[0]).toMatchObject({ phone: "919812345678", name: "Asha", tags: ["vip", "june"] });
    expect(mapping.some(m => m.startsWith("batch"))).toBe(false);
    expect(rows[0].batchName).toBeUndefined();
  });

  it("still supports a headerless positional file", () => {
    const { rows } = mapCsvRows(parseCsvText("919812345678,Asha,vip\n9289311196,Ravi,new"));
    expect(rows.length).toBe(2);
    expect(rows[0].name).toBe("Asha");
    expect(rows[1].phone).toBe("919289311196");   // normalised too
  });
});
