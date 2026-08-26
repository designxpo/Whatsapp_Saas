// CSV import: parsing, column auto-mapping, and phone normalisation.
//
// Extracted from the admin page so the mapping rules are testable — they decide
// which contacts get created and what number they are messaged on, which is not
// something to leave unverified.

// ── CSV upload + auto column mapping ──
export type ImportRow = {
  phone: string; name?: string; email?: string; tags?: string[];
  attributes?: Record<string, string>;
  /** From a "Batch Name"-style column: which batch this row should join. */
  batchName?: string;
  /** True when the export marks the person blocked (User/Course/Payment). */
  blocked?: boolean;
};

// Minimal CSV parser — handles quoted fields and CRLF.
export function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let cur = "", row: string[] = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); cur = "";
      if (row.some(c => c.trim() !== "")) rows.push(row);
      row = [];
    } else cur += ch;
  }
  row.push(cur);
  if (row.some(c => c.trim() !== "")) rows.push(row);
  return rows;
}

const CSV_COL: Record<string, string[]> = {
  phone: ["phone", "mobile", "mobile number", "mobile_no", "whatsapp", "whatsapp number", "number",
          "contact", "contact number", "phone number", "msisdn",
          // Student-list exports from the LMS
          "student phone", "student mobile", "student number", "student contact"],
  name: ["name", "full name", "fullname", "first name", "contact name", "customer name", "lead name",
         "student name"],
  email: ["email", "e-mail", "email id", "email address", "student email", "student email id"],
  tags: ["tags", "tag", "labels", "label", "groups", "segment"],
  // A column naming the audience this row belongs to. When present the import
  // creates each named batch and puts its rows straight into it, instead of
  // making the operator pick one batch for a whole mixed file.
  batch: ["batch", "batch name", "batch_name", "cohort", "cohort name", "class", "section"],
};

// A 10-digit Indian mobile is what most exports contain, but WhatsApp needs the
// country code — storing the bare 10 digits produces a number Meta cannot route,
// so every send to it fails. Normalise on the way in, and show the result in the
// preview so the operator can see what will actually be stored.
export function normalisePhone(raw: string, defaultCc = "91"): string {
  let d = (raw || "").replace(/\D/g, "");
  if (!d) return "";
  const cc = defaultCc.replace(/\D/g, "") || "91";
  // 0XXXXXXXXXX — a domestic trunk prefix, never part of the international number.
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (d.length === 13 && d.startsWith("0" + cc)) d = d.slice(1);
  // Exactly a national number → prepend the country code.
  if (d.length === 10) d = cc + d;
  return d;
}
const looksLikePhone = (s: string) => /^\+?\d[\d\s()-]{7,}$/.test(s.trim());

// Auto-detects the header row and maps columns: known headers → fields, every
// other headed column → a contact attribute. Headerless files fall back to
// positional phone,name,tags.
export function mapCsvRows(cells: string[][], defaultCc = "91"): { rows: ImportRow[]; mapping: string[] } {
  if (!cells.length) return { rows: [], mapping: [] };
  const head = cells[0].map(c => c.trim().toLowerCase());
  const find = (names: string[]) => head.findIndex(h => names.includes(h));
  let pi = find(CSV_COL.phone);
  let ni = find(CSV_COL.name);
  const ei = find(CSV_COL.email);
  let ti = find(CSV_COL.tags);
  const bi = find(CSV_COL.batch);
  const hasHeader = pi >= 0 || ni >= 0 || ei >= 0 || ti >= 0 || bi >= 0 || !looksLikePhone(cells[0][0] ?? "");
  if (pi < 0) pi = 0;
  if (!hasHeader) { if (ni < 0) ni = 1; if (ti < 0) ti = 2; }

  const attrCols: { idx: number; key: string }[] = [];
  if (hasHeader) {
    cells[0].forEach((h, idx) => {
      if (idx !== pi && idx !== ni && idx !== ei && idx !== ti && idx !== bi && h.trim()) attrCols.push({ idx, key: h.trim() });
    });
  }
  const dataRows = hasHeader ? cells.slice(1) : cells;
  // Exports mark people who must not be contacted. Read every such flag we can
  // see rather than only the one this file happens to use.
  const blockedCols = hasHeader
    ? cells[0].map((h, idx) => ({ idx, h: h.trim().toLowerCase() }))
        .filter(x => /blocked/.test(x.h)).map(x => x.idx)
    : [];
  const truthy = (v: string) => /^(true|yes|1|y)$/i.test((v || "").trim());

  const rows: ImportRow[] = dataRows.map(r => {
    const attributes: Record<string, string> = {};
    for (const a of attrCols) { const v = (r[a.idx] ?? "").trim(); if (v) attributes[a.key] = v; }
    const rawPhone = (r[pi] ?? "").trim();
    return {
      // Keep the raw value out of `phone` — what is stored is what gets messaged.
      phone: looksLikePhone(rawPhone) ? normalisePhone(rawPhone, defaultCc) : rawPhone,
      name: ni >= 0 ? (r[ni] ?? "").trim() : "",
      email: ei >= 0 ? ((r[ei] ?? "").trim() || undefined) : undefined,
      tags: ti >= 0 ? (r[ti] ?? "").split(/[;|]/).map(t => t.trim()).filter(Boolean) : [],
      ...(bi >= 0 && (r[bi] ?? "").trim() ? { batchName: (r[bi] ?? "").trim() } : {}),
      ...(blockedCols.some(i => truthy(r[i] ?? "")) ? { blocked: true } : {}),
      ...(Object.keys(attributes).length ? { attributes } : {}),
    };
  }).filter(r => r.phone.length >= 10 && /^\d+$/.test(r.phone));
  const mapping = [
    `phone ← ${hasHeader ? `"${cells[0][pi]?.trim() || "column 1"}"` : "column 1"}`,
    ni >= 0 ? `name ← ${hasHeader ? `"${cells[0][ni]?.trim()}"` : "column 2"}` : null,
    ei >= 0 ? `email ← "${cells[0][ei]?.trim()}"` : null,
    ti >= 0 ? `tags ← ${hasHeader ? `"${cells[0][ti]?.trim()}"` : "column 3"}` : null,
    bi >= 0 ? `batch ← "${cells[0][bi]?.trim()}"` : null,
    ...attrCols.map(a => `attribute "${a.key}"`),
  ].filter(Boolean) as string[];
  return { rows, mapping };
}


// ── Other upload formats ────────────────────────────────────────────────────
// Exports arrive as whatever the source system produces: comma CSV, semicolon
// CSV (Excel in several locales), tab-separated (what Excel puts on the
// clipboard), or a real .xlsx workbook. Rejecting those forces people to
// re-save files by hand, which is where transcription mistakes come from.

/** Delimiter used by the header line: whichever splits it into most columns. */
export function detectDelimiter(text: string): string {
  const line = (text.split(/\r?\n/).find(l => l.trim() !== "") ?? "");
  const counts = [",", ";", "\t", "|"].map(d => {
    // Count only separators OUTSIDE quotes, or a quoted "Doe, John" inflates ",".
    let n = 0, inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') inQ = !inQ;
      else if (!inQ && ch === d) n++;
    }
    return { d, n };
  });
  counts.sort((a, b) => b.n - a.n);
  return counts[0].n > 0 ? counts[0].d : ",";
}

/** Delimited text → rows. Handles quoted fields, escaped quotes and CRLF. */
export function parseDelimited(text: string, delimiter?: string): string[][] {
  const d = delimiter ?? detectDelimiter(text);
  const rows: string[][] = [];
  let cur = "", row: string[] = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === d) { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); cur = "";
      if (row.some(c => c.trim() !== "")) rows.push(row);
      row = [];
    } else cur += ch;
  }
  row.push(cur);
  if (row.some(c => c.trim() !== "")) rows.push(row);
  return rows;
}

const XML_ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unxml = (s: string) => s.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (m, e: string) => {
  if (e.startsWith("#x") || e.startsWith("#X")) return String.fromCodePoint(parseInt(e.slice(2), 16));
  if (e.startsWith("#")) return String.fromCodePoint(parseInt(e.slice(1), 10));
  return XML_ENT[e] ?? m;
});

/** "AB12" → 27 (zero-based column index). */
function colIndex(ref: string): number {
  const letters = (ref.match(/^[A-Z]+/) ?? [""])[0];
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return Math.max(0, n - 1);
}

// ── Minimal .xlsx reader ────────────────────────────────────────────────────
// A .xlsx is a ZIP of XML. Deliberately dependency-free: the obvious library
// (xlsx@0.18.5, the newest on npm) carries a high-severity ReDoS advisory, and
// this runs on files a user hands us. Only what a contact list needs is read —
// the first worksheet, as text.
async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const DS = (globalThis as { DecompressionStream?: typeof DecompressionStream }).DecompressionStream;
  if (!DS) throw new Error("This browser can't unzip .xlsx — save the file as CSV and upload that.");
  const stream = new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(new DS("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Every file in the zip, by name. */
async function unzip(buf: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const b = new Uint8Array(buf);
  const dv = new DataView(buf);
  // End of Central Directory — scan back from the tail; a comment may follow it.
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 66_000); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("That doesn't look like a valid .xlsx file.");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);

  const out = new Map<string, Uint8Array>();
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const cmtLen = dv.getUint16(p + 32, true);
    const localAt = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nameLen));
    // The local header repeats the name/extra with its OWN lengths — the extra
    // field commonly differs from the central one, so re-read it here.
    const lNameLen = dv.getUint16(localAt + 26, true);
    const lExtraLen = dv.getUint16(localAt + 28, true);
    const dataAt = localAt + 30 + lNameLen + lExtraLen;
    const raw = b.subarray(dataAt, dataAt + compSize);
    if (name.endsWith("/")) { p += 46 + nameLen + extraLen + cmtLen; continue; }
    out.set(name, method === 0 ? raw : await inflateRaw(raw));
    p += 46 + nameLen + extraLen + cmtLen;
  }
  return out;
}

/** First worksheet of an .xlsx as rows of text. */
export async function parseXlsx(buf: ArrayBuffer): Promise<string[][]> {
  const files = await unzip(buf);
  const dec = (n: string) => { const f = files.get(n); return f ? new TextDecoder().decode(f) : ""; };

  // Shared strings: <si> may hold one <t> or several (rich text runs).
  const shared: string[] = [];
  for (const si of dec("xl/sharedStrings.xml").match(/<si\b[\s\S]*?<\/si>/g) ?? []) {
    shared.push(unxml([...si.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(m => m[1]).join("")));
  }

  // Workbook order, not zip order — sheet1.xml is not reliably the first sheet.
  const rels = dec("xl/_rels/workbook.xml.rels");
  const firstId = (dec("xl/workbook.xml").match(/<sheet\b[^>]*r:id="([^"]+)"/) ?? [])[1];
  const target = firstId
    ? (rels.match(new RegExp(`Id="${firstId}"[^>]*Target="([^"]+)"`)) ?? [])[1]
    : undefined;
  const sheetName = target
    ? `xl/${target.replace(/^\/?xl\//, "").replace(/^\//, "")}`
    : [...files.keys()].find(k => /^xl\/worksheets\/.*\.xml$/.test(k));
  if (!sheetName) throw new Error("No worksheet found in that .xlsx file.");

  const rows: string[][] = [];
  for (const rowXml of dec(sheetName).match(/<row\b[\s\S]*?(?:\/>|<\/row>)/g) ?? []) {
    const cells: string[] = [];
    for (const c of rowXml.match(/<c\b[\s\S]*?(?:\/>|<\/c>)/g) ?? []) {
      const ref = (c.match(/\br="([A-Z]+\d+)"/) ?? [])[1];
      const type = (c.match(/\bt="([^"]+)"/) ?? [])[1] ?? "n";
      const v = (c.match(/<v\b[^>]*>([\s\S]*?)<\/v>/) ?? [])[1];
      let text: string;
      if (type === "s") text = shared[parseInt(v ?? "-1", 10)] ?? "";
      else if (type === "inlineStr") text = unxml([...c.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(m => m[1]).join(""));
      else text = unxml(v ?? "");
      // Sparse sheets skip empty cells, so place by column reference — otherwise
      // a blank middle column shifts every later value into the wrong field.
      const at = ref ? colIndex(ref) : cells.length;
      while (cells.length < at) cells.push("");
      cells[at] = text;
    }
    if (cells.some(x => x.trim() !== "")) rows.push(cells);
  }
  return rows;
}

/**
 * Any supported upload → rows. Dispatches on extension, falling back to
 * delimited text, so an unrecognised extension holding a CSV still works.
 */
export async function readTable(file: File): Promise<string[][]> {
  const name = (file.name || "").toLowerCase();
  if (name.endsWith(".xlsx")) return parseXlsx(await file.arrayBuffer());
  if (name.endsWith(".xls")) {
    // Pre-2007 binary format — a different container entirely, not worth
    // carrying a parser for. Say so plainly instead of failing obscurely.
    throw new Error("Old .xls files aren't supported — open it in Excel and 'Save As' .xlsx or .csv.");
  }
  return parseDelimited(await file.text());
}
