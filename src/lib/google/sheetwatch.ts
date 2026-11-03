// Rows added to a business's sheet → their WhatsApp messages.
//
// Run from the cron. Every live google_sheets inbound connection is read once:
// each row with a phone and an empty status cell is one event,
// google_sheets.row_added, handed to the inbound ingest like any connected
// tool's event — the person lands in Contacts and the business's own Messages
// (API rules) decide what is sent, with the row's columns as
// {{payload.<column>}}. A connector never sends a message itself.
//
// Whose sheet: each connection row carries its tenant_id, and everything done
// for it — the ingest, the contact, the rules — is done for that tenant.
//
// Each row's outcome is written into its status cell, so the business sees in
// the sheet what happened to every row, and a row with a status is never
// picked up again. Two guards against messaging a row twice:
//   - the status cell (the visible one), and
//   - the event log's unique (connection, external id), where the id is the
//     row's position AND content: two overlapping cron runs, or a status write
//     that failed, cannot send the same row again. A row whose content changes
//     is a different row. A FAILED row can be retried by clearing its status
//     (the log lets a failed id be claimed again); a sent one is not sent twice.
//
// Google's quota for one account is about 60 reads and 60 writes a minute,
// shared by every business (they all use the portal's one service account), so
// this costs at most one read and one write per watched tab per run.

import { createHash } from "crypto";
import { liveConnectionsOfKind, noteActivity, type Integration } from "../inbound/store";
import { ingestEvents, type NormalizedEvent } from "../inbound/ingest";
import { normalizePhone, tagsFrom, type Json } from "../inbound/normalize";
import { readTab, writeCells, a1, colLetter, columnsOf, columnKeys, sheetTime, accessProblem, STATUS_HEADER } from "./sheets";

export const ROW_EVENT = "google_sheets.row_added";

/** Rows handled per tab per run: a pasted batch of 500 drains over a few runs, not in one burst. */
const ROWS_PER_RUN = 25;

export function rowExternalId(spreadsheetId: string, tab: string, rowNumber: number, row: string[], statusCol: number): string {
  const content = row.map((c, i) => (i === statusCol ? "" : c.trim())).join("␟");
  return `row:${createHash("sha256").update(`${spreadsheetId}|${tab}|${rowNumber}|${content}`).digest("hex").slice(0, 40)}`;
}

/** One row as the event ingest acts on. Pure. */
export function rowEvent(p: {
  spreadsheetId: string; tab: string; sheetTitle: string; rowNumber: number; row: string[];
  header: string[]; config: Record<string, string>;
}): NormalizedEvent {
  const cols = columnsOf(p.header);
  const keys = columnKeys(p.header);
  const cell = (i: number) => (i >= 0 ? (p.row[i] ?? "").trim() : "");
  const data: Json = { row: p.rowNumber, sheet: p.sheetTitle, tab: p.tab };
  const attributes: Record<string, string> = {};
  keys.forEach((k, i) => {
    if (!k) return;
    const v = cell(i);
    data[k] = v;
    // Prefixed, so a column can never overwrite an attribute the rest of the
    // portal relies on (CRM ids, utm_source…).
    if (v && i !== cols.phone && i !== cols.email) attributes[`sheet_${k}`.slice(0, 60)] = v.slice(0, 300);
  });
  return {
    eventKey: ROW_EVENT,
    externalId: rowExternalId(p.spreadsheetId, p.tab, p.rowNumber, p.row, cols.status),
    phone: normalizePhone(cell(cols.phone), p.config.defaultCountryCode || "91"),
    name: cell(cols.name),
    email: cell(cols.email),
    data,
    tags: tagsFrom(p.config.tags, "Google Sheets"),
    attributes,
  };
}

/** What goes in the row's status cell. */
export function statusText(outcome: string, detail: string, at = new Date()): string {
  const when = sheetTime(at);
  if (outcome === "processed") return `Done ${when}: ${detail}`;
  if (outcome === "ignored") return `Skipped ${when}: no valid WhatsApp number in this row. Fix it and clear this cell to try again.`;
  return `Failed ${when}: ${detail} Clear this cell to try again.`;
}

export interface SheetRunResult { tabs: number; rows: number; failed: number }

/** Watch every business's connected sheet. */
export async function drainSheetRows(deadlineAt = Date.now() + 30_000): Promise<SheetRunResult> {
  const result: SheetRunResult = { tabs: 0, rows: 0, failed: 0 };
  const connections = (await liveConnectionsOfKind("google_sheets"))
    .filter(c => (c.row.config.sendTab ?? "").trim() && c.row.config.spreadsheetId && c.row.tenantId);
  for (const { row } of connections) {
    if (Date.now() > deadlineAt) break;
    result.tabs++;
    try {
      const r = await watchOne(row, deadlineAt);
      result.rows += r.rows; result.failed += r.failed;
    } catch (err) {
      result.failed++;
      await noteActivity(row, { error: `Reading the sheet: ${accessProblem(err)}` }).catch(() => undefined);
    }
  }
  return result;
}

async function watchOne(conn: Integration, deadlineAt: number): Promise<{ rows: number; failed: number }> {
  const id = conn.config.spreadsheetId;
  const tab = conn.config.sendTab.trim();
  const rows = await readTab(id, tab);
  const header = rows[0] ?? [];
  const cols = columnsOf(header);
  if (cols.phone < 0) throw new Error(`The first row of “${tab}” no longer has a Phone column.`);
  // The status column was deleted: put the header back first, so this run's
  // statuses land under it.
  const statusCol = cols.status >= 0 ? cols.status : header.length;
  const writes: { range: string; values: string[][] }[] = [];
  if (cols.status < 0) writes.push({ range: a1(tab, `${colLetter(statusCol)}1`), values: [[STATUS_HEADER]] });

  let done = 0, failed = 0;
  for (let i = 1; i < rows.length && done < ROWS_PER_RUN; i++) {
    if (Date.now() > deadlineAt) break;
    const r = rows[i];
    if ((r[statusCol] ?? "").trim()) continue;
    if (!r.some((c, j) => j !== statusCol && c.trim())) continue;   // an empty row
    const event = rowEvent({ spreadsheetId: id, tab, sheetTitle: conn.config.sheetTitle ?? "", rowNumber: i + 1, row: r, header, config: conn.config });
    const [outcome] = await ingestEvents(conn, [event]);
    if (!outcome) continue;
    if (outcome.outcome === "duplicate") {
      // This exact row (same place, same details) was handled before and
      // someone cleared its status. Say so, rather than leave a blank cell
      // that looks queued forever. When two runs overlap, the one that
      // actually handled it writes its status after this, so it wins.
      writes.push({ range: a1(tab, `${colLetter(statusCol)}${i + 1}`), values: [[`Already handled ${sheetTime(new Date())}: this exact row was processed before. To send it again, add it as a new row.`]] });
      continue;
    }
    done++;
    if (outcome.outcome === "failed") failed++;
    writes.push({ range: a1(tab, `${colLetter(statusCol)}${i + 1}`), values: [[statusText(outcome.outcome, outcome.detail)]] });
  }
  await writeCells(id, writes);
  return { rows: done, failed };
}
