// Google Sheets, both ways:
//
//  - OUT: the events a business ticks are appended as rows to a tab ("Portal
//    log" unless they name another) — the google_sheets connector in
//    src/lib/integrations.ts.
//  - IN: rows added to a tab they name are messaged on WhatsApp — the
//    google_sheets inbound connection, watched from the cron (sheetwatch.ts).
//
// The business shares the sheet with the portal's service account (auth.ts)
// as an Editor. Every value is written RAW: a lead who types "=IMPORTXML(…)"
// puts that text in the cell, not a formula the sheet would run.
//
// Sheets API v4 facts relied on (developers.google.com/sheets/api/reference/rest):
//   GET  /v4/spreadsheets/{id}?fields=…                       → properties.title, sheets[].properties.title
//   POST /v4/spreadsheets/{id}:batchUpdate {requests:[{addSheet:{properties:{title}}}]}
//   GET  /v4/spreadsheets/{id}/values/{range}                  → values: string[][] (trailing blanks omitted)
//   POST /v4/spreadsheets/{id}/values/{range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS
//   POST /v4/spreadsheets/{id}/values:batchUpdate {valueInputOption, data:[{range, values}]}

import { BUSINESS_TZ } from "../businessclock";
import { slug } from "../inbound/normalize";
import { googleCall, GoogleApiError } from "./api";
import { googleRobotEmail } from "./auth";

const API = "https://sheets.googleapis.com/v4/spreadsheets";

export const DEFAULT_LOG_TAB = "Portal log";
export const STATUS_HEADER = "Portal status";
export const LOG_HEADERS = ["When", "Event", "Name", "Phone", "Email", "Details"];

/** The spreadsheet id in a sheet's link (or a bare id); null when there is none. */
export function spreadsheetIdFrom(input: string): string | null {
  const s = (input ?? "").trim();
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/);
  if (m) return m[1];
  return /^[a-zA-Z0-9_-]{25,}$/.test(s) ? s : null;
}

/** A1 range on a named tab. Tab names are quoted, with any ' doubled. */
export const a1 = (tab: string, range: string) => `'${tab.replace(/'/g, "''")}'!${range}`;

/** Column letter for a 0-based index: 0 → A, 25 → Z, 26 → AA. */
export function colLetter(i: number): string {
  let n = i + 1, s = "";
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/** What to tell the business when Google refuses: something they can act on. */
export function accessProblem(err: unknown, what = "this sheet"): string {
  const robot = googleRobotEmail();
  if (err instanceof GoogleApiError) {
    if (err.status === 403) return `The portal can't open ${what}. In Google Sheets click Share and add ${robot ?? "the portal's Google address"} as an Editor.`;
    if (err.status === 404) return "That sheet doesn't exist, or the link is wrong. Copy the link from your browser's address bar while the sheet is open.";
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

const enc = encodeURIComponent;

export async function sheetMeta(id: string): Promise<{ title: string; tabs: string[] }> {
  const d = await googleCall("GET", `${API}/${enc(id)}?fields=${enc("properties.title,sheets.properties.title")}`);
  const title = String((d.properties as { title?: unknown } | undefined)?.title ?? "");
  const tabs = ((d.sheets as { properties?: { title?: unknown } }[] | undefined) ?? []).map(s => String(s.properties?.title ?? "")).filter(Boolean);
  return { title, tabs };
}

export async function addTab(id: string, title: string): Promise<void> {
  await googleCall("POST", `${API}/${enc(id)}:batchUpdate`, { requests: [{ addSheet: { properties: { title } } }] });
}

/** Every row of a tab, as text the way the sheet shows it. */
export async function readTab(id: string, tab: string): Promise<string[][]> {
  const d = await googleCall("GET", `${API}/${enc(id)}/values/${enc(a1(tab, "A1:AZ"))}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`);
  return ((d.values as unknown[][] | undefined) ?? []).map(r => (r ?? []).map(c => (c === null || c === undefined ? "" : String(c))));
}

export async function appendRows(id: string, tab: string, rows: string[][]): Promise<void> {
  await googleCall("POST", `${API}/${enc(id)}/values/${enc(a1(tab, "A1"))}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, { values: rows });
}

export async function writeCells(id: string, data: { range: string; values: string[][] }[]): Promise<void> {
  if (!data.length) return;
  await googleCall("POST", `${API}/${enc(id)}/values:batchUpdate`, { valueInputOption: "RAW", data });
}

/** "3 Nov 2026, 4:30 pm" in the business's time zone. */
export function sheetTime(at: Date, tz = BUSINESS_TZ()): string {
  const date = new Intl.DateTimeFormat("en-IN", { timeZone: tz, day: "numeric", month: "short", year: "numeric" }).format(at);
  const time = new Intl.DateTimeFormat("en-IN", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true }).format(at);
  return `${date}, ${time}`;
}

// ── The log tab (events out) ─────────────────────────────────────────────────

/** Check the sheet can be opened and give the log tab its headings. */
export async function prepareLogTab(id: string, tab: string): Promise<{ title: string }> {
  const meta = await sheetMeta(id);
  if (!meta.tabs.includes(tab)) await addTab(id, tab);
  const top = (await readTab(id, tab))[0] ?? [];
  if (!top.some(c => c.trim())) await writeCells(id, [{ range: a1(tab, "A1"), values: [LOG_HEADERS] }]);
  return { title: meta.title };
}

/** Append one row to the log tab, putting the tab back (with its headings) if someone deleted it. */
export async function appendLogRow(id: string, tab: string, row: string[]): Promise<"appended" | "recreated"> {
  try {
    await appendRows(id, tab, [row]);
    return "appended";
  } catch (err) {
    if (err instanceof GoogleApiError && err.status === 400 && /parse range/i.test(err.message)) {
      await addTab(id, tab);
      await appendRows(id, tab, [LOG_HEADERS, row]);
      return "recreated";
    }
    throw err;
  }
}

// ── The tab a business messages from (rows in) ───────────────────────────────

const PHONE_HEADER = /phone|mobile|whats\s*app|contact\s*(no|number)|^number$|^cell/i;
const NAME_HEADER = /^(full\s*)?name$|customer\s*name|student\s*name|lead\s*name|^first\s*name$/i;
const EMAIL_HEADER = /e-?mail/i;

export interface SheetColumns { phone: number; name: number; email: number; status: number; headers: string[] }

/** Which column is which, from the header row. -1 when absent. */
export function columnsOf(header: string[]): SheetColumns {
  const h = header.map(c => (c ?? "").trim());
  const find = (re: RegExp) => h.findIndex(c => c && re.test(c) && c.toLowerCase() !== STATUS_HEADER.toLowerCase());
  return {
    phone: find(PHONE_HEADER),
    name: find(NAME_HEADER),
    email: find(EMAIL_HEADER),
    status: h.findIndex(c => c.toLowerCase() === STATUS_HEADER.toLowerCase()),
    headers: h,
  };
}

/** The template-variable names for a header row: "Fee Amount" → fee_amount. Unnamed columns are skipped. */
export function columnKeys(header: string[]): string[] {
  const seen = new Set<string>();
  return header.map((c, i) => {
    if (!c.trim() || c.trim().toLowerCase() === STATUS_HEADER.toLowerCase()) return "";
    let k = slug(c);
    if (k === "received") k = `column_${colLetter(i).toLowerCase()}`;
    while (seen.has(k)) k = `${k}_${colLetter(i).toLowerCase()}`;
    seen.add(k);
    return k;
  });
}

const rowHasContent = (r: string[], skip: number) => r.some((c, i) => i !== skip && c.trim() !== "");

/**
 * Get a tab ready to be watched: a status column in its header row and, the
 * first time this tab is connected, every row already there marked so it is
 * never messaged — connecting a sheet of 2,000 old leads must not message
 * 2,000 people. Clearing a row's status cell later messages it.
 */
export async function prepareSendTab(id: string, tab: string, baselineDone: boolean): Promise<{ columns: string[]; marked: number }> {
  const rows = await readTab(id, tab);
  const header = rows[0] ?? [];
  const cols = columnsOf(header);
  if (cols.phone < 0) {
    throw new Error(`The first row of “${tab}” needs a column called Phone (or Mobile, or WhatsApp): that's who gets the message.`);
  }
  const statusCol = cols.status >= 0 ? cols.status : header.length;
  const writes: { range: string; values: string[][] }[] = [];
  if (cols.status < 0) writes.push({ range: a1(tab, `${colLetter(statusCol)}1`), values: [[STATUS_HEADER]] });
  let marked = 0;
  if (!baselineDone) {
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (!rowHasContent(r, statusCol) || (r[statusCol] ?? "").trim()) continue;
      writes.push({ range: a1(tab, `${colLetter(statusCol)}${i + 1}`), values: [["Already here when the portal was connected: not messaged. Clear this cell to message it."]] });
      marked++;
    }
  }
  await writeCells(id, writes);
  return { columns: columnKeys(header).filter(Boolean), marked };
}
