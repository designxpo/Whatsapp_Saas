import { describe, it, expect } from "vitest";
import { deflateRawSync } from "node:zlib";
import { detectDelimiter, parseDelimited, parseXlsx, mapCsvRows } from "../csv-import";

// Uploads arrive as whatever the source system produced. These cover the
// formats a student/contact list realistically shows up in.

// ── a real .xlsx, built here so the reader is tested end to end ──────────────
// Deliberately a genuine ZIP with real deflate streams (not "stored"), because
// the inflate path is the part most likely to be wrong.
function zip(entries: { name: string; body: string }[], store = false): ArrayBuffer {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const e of entries) {
    const raw = enc.encode(e.body);
    const data = store ? raw : new Uint8Array(deflateRawSync(raw));
    const nameB = enc.encode(e.name);
    const method = store ? 0 : 8;

    const lh = new Uint8Array(30 + nameB.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true);
    lv.setUint16(8, method, true);
    lv.setUint32(14, 0, true);                     // crc32 — unchecked by the reader
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, nameB.length, true);
    lh.set(nameB, 30);
    locals.push(lh, data);

    const ch = new Uint8Array(46 + nameB.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
    cv.setUint16(10, method, true);
    cv.setUint32(16, 0, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, nameB.length, true);
    cv.setUint32(42, offset, true);
    ch.set(nameB, 46);
    centrals.push(ch);
    offset += lh.length + data.length;
  }

  const cdSize = centrals.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true);

  const all = [...locals, ...centrals, eocd];
  const total = all.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of all) { out.set(p, at); at += p.length; }
  return out.buffer;
}

const SHEET = `<?xml version="1.0"?><worksheet><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>
<row r="2"><c r="A2" t="s"><v>3</v></c><c r="C2" t="inlineStr"><is><t>9289311196</t></is></c></row>
<row r="3"><c r="A3" t="s"><v>4</v></c><c r="B3" t="s"><v>5</v></c><c r="C3"><v>918459602964</v></c></row>
</sheetData></worksheet>`;
const SHARED = `<?xml version="1.0"?><sst>
<si><t>Batch Name</t></si><si><t>Name</t></si><si><t>Student Phone</t></si>
<si><t>BT DVA (NOI) AUG 2026</t></si>
<si><t>BT DVA (NOI) AUG 2026</t></si><si><r><t>Gurvansh</t></r><r><t> Singh</t></r></si>
</sst>`;
const WORKBOOK = `<workbook><sheets><sheet name="Students" sheetId="1" r:id="rId7"/></sheets></workbook>`;
const RELS = `<Relationships><Relationship Id="rId7" Target="worksheets/sheetB.xml"/></Relationships>`;

const book = (store = false) => zip([
  { name: "xl/workbook.xml", body: WORKBOOK },
  { name: "xl/_rels/workbook.xml.rels", body: RELS },
  { name: "xl/sharedStrings.xml", body: SHARED },
  { name: "xl/worksheets/sheetB.xml", body: SHEET },
], store);

describe("xlsx reader", () => {
  it("reads a deflate-compressed workbook", async () => {
    const rows = await parseXlsx(book());
    expect(rows[0]).toEqual(["Batch Name", "Name", "Student Phone"]);
  });

  it("reads a stored (uncompressed) workbook too", async () => {
    const rows = await parseXlsx(book(true));
    expect(rows[0]).toEqual(["Batch Name", "Name", "Student Phone"]);
  });

  it("follows the workbook relationship instead of guessing sheet1.xml", async () => {
    // The sheet here is sheetB.xml. Picking the first worksheet by filename
    // would read the wrong sheet in a multi-sheet book.
    const rows = await parseXlsx(book());
    expect(rows.length).toBe(3);
  });

  it("keeps a blank middle cell in its own column", async () => {
    // Row 2 has A and C but no B. Appending in document order would slide the
    // phone into the Name column and every contact would be messaged wrongly.
    const rows = await parseXlsx(book());
    expect(rows[1]).toEqual(["BT DVA (NOI) AUG 2026", "", "9289311196"]);
  });

  it("joins rich-text runs and reads plain numeric cells", async () => {
    const rows = await parseXlsx(book());
    expect(rows[2][1]).toBe("Gurvansh Singh");     // two <r> runs
    expect(rows[2][2]).toBe("918459602964");       // untyped <v>
  });

  it("feeds straight into the column mapper", async () => {
    const { rows, mapping } = mapCsvRows(await parseXlsx(book()));
    expect(mapping).toContain('phone ← "Student Phone"');
    expect(mapping).toContain('batch ← "Batch Name"');
    expect(rows.map(r => r.phone)).toEqual(["919289311196", "918459602964"]);
    expect(rows[1].name).toBe("Gurvansh Singh");
  });

  it("rejects a file that isn't a zip, with a readable message", async () => {
    await expect(parseXlsx(new TextEncoder().encode("just,some,text").buffer as ArrayBuffer))
      .rejects.toThrow(/valid \.xlsx/i);
  });
});

describe("delimiter detection", () => {
  it("spots semicolon, tab and pipe files", () => {
    expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";");
    expect(detectDelimiter("a\tb\tc")).toBe("\t");
    expect(detectDelimiter("a|b|c")).toBe("|");
    expect(detectDelimiter("a,b,c")).toBe(",");
  });

  it("is not fooled by a comma inside a quoted field", () => {
    // Excel in a European locale: semicolon separators, commas inside values.
    expect(detectDelimiter('Name;Phone\n"Doe, John";919812345678')).toBe(";");
  });

  it("falls back to comma for a single-column file", () => {
    expect(detectDelimiter("phone\n919812345678")).toBe(",");
  });
});

describe("delimited parsing across formats", () => {
  it("parses a semicolon export the same as a comma one", () => {
    const semi = parseDelimited("Student Phone;Name;Batch Name\n9289311196;Ishu;AUG 2026");
    const comma = parseDelimited("Student Phone,Name,Batch Name\n9289311196,Ishu,AUG 2026");
    expect(semi).toEqual(comma);
  });

  it("parses tab-separated text — what Excel puts on the clipboard", () => {
    const rows = parseDelimited("Student Phone\tName\n9289311196\tIshu");
    const { rows: mapped } = mapCsvRows(rows);
    expect(mapped[0]).toMatchObject({ phone: "919289311196", name: "Ishu" });
  });

  it("keeps quoted separators inside the value", () => {
    const rows = parseDelimited('Name;Phone\n"Doe, John";919812345678');
    expect(rows[1]).toEqual(["Doe, John", "919812345678"]);
  });

  it("handles escaped quotes and CRLF line endings", () => {
    const rows = parseDelimited('Name,Phone\r\n"She said ""hi""",919812345678\r\n');
    expect(rows[1][0]).toBe('She said "hi"');
  });
});
