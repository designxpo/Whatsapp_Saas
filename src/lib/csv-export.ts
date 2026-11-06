// Spreadsheet downloads for the data screens (Analytics, Results, Team Progress).
//
// Pure apart from downloadCsv(): the text is built here and unit-tested, so a
// file opened in Excel on an Indian laptop shows "₹1,23,456"-free plain numbers,
// readable dates and the right characters.
//
//  - A UTF-8 byte-order mark goes first. Without it Excel on Windows reads the
//    file as the local code page, so "₹", "—" and any Hindi name turn to junk.
//  - Every text cell is quoted, quotes inside it doubled, and one that starts
//    with = + - @ (or a tab/return) gets a leading ' so a customer's name can
//    never run as a formula. Numbers stay bare numbers, so they still add up.
//  - Rows end with CRLF, the line ending RFC 4180 and Excel expect.

export type CsvValue = string | number | boolean | null | undefined;
export interface CsvSection { title?: string; header: string[]; rows: CsvValue[][] }

export const BOM = "﻿";

/** One cell, safe for Excel and Google Sheets. */
export function csvCell(v: CsvValue): string {
  if (v == null) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  let s = v;
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** A header plus rows as CSV text (with the BOM unless told otherwise). */
export function toCsv(header: string[], rows: CsvValue[][], opts: { bom?: boolean } = {}): string {
  const body = [header, ...rows].map(r => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
  return (opts.bom === false ? "" : BOM) + body;
}

/**
 * Several tables in one file — each under its own title row, a blank line
 * between them. How a multi-table report (Results) reads in one spreadsheet.
 */
export function toCsvSections(sections: CsvSection[], opts: { bom?: boolean } = {}): string {
  const blocks = sections.map(s => {
    const lines: string[] = [];
    if (s.title) lines.push(csvCell(s.title));
    lines.push(s.header.map(csvCell).join(","));
    for (const r of s.rows) lines.push(r.map(csvCell).join(","));
    return lines.join("\r\n");
  });
  return (opts.bom === false ? "" : BOM) + blocks.join("\r\n\r\n") + "\r\n";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * A date as "6 Nov 2026" — Indian day-month order, with the month in words so
 * no spreadsheet can read it the American way round (06/11 as 11 June).
 * Accepts YYYY-MM-DD (a calendar day, taken as-is) or a full ISO time.
 */
export function csvDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (m) return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** Rupees from paise/cents for a spreadsheet: a plain number, two decimals at most. */
export function csvRupees(cents: number | null | undefined): number | null {
  return typeof cents === "number" && Number.isFinite(cents) ? Math.round(cents) / 100 : null;
}

/** "talko-analytics-last-30-days-2026-11-06.csv" — lower-case, no spaces or odd characters. */
export function csvFileName(parts: string[], today: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const day = `${today.getFullYear()}-${p(today.getMonth() + 1)}-${p(today.getDate())}`;
  const slug = ["talko", ...parts, day]
    .map(s => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""))
    .filter(Boolean)
    .join("-");
  return `${slug}.csv`;
}

/** Hand the browser a CSV to save. No-op outside a browser. */
export function downloadCsv(fileName: string, csv: string): void {
  if (typeof document === "undefined") return;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = fileName;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
