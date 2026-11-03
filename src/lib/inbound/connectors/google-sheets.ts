// Google Sheets, inbound: rows added to a tab the business names are messaged
// on WhatsApp.
//
// Google does not post to us: the portal reads the tab from the cron
// (src/lib/google/sheetwatch.ts). So this connector has no delivery to verify
// and refuses anything posted to its URL. What it does is the connect step:
// check the sheet is shared with the portal, find the Phone column, add the
// status column, and — the first time a tab is connected — mark every row
// already there so it is never messaged.

import type { Provider } from "../providers";
import { googleRobotEmail, NOT_SET_UP } from "../../google/auth";
import { spreadsheetIdFrom, sheetMeta, prepareSendTab, accessProblem } from "../../google/sheets";

export const googleSheetsProvider: Provider = {
  verify: () => "Google Sheets doesn't post to this address: the portal reads the sheet itself.",
  parse: () => [],
  async connect({ config }) {
    if (!googleRobotEmail()) return { ok: false, detail: NOT_SET_UP };
    const id = spreadsheetIdFrom(config.spreadsheetUrl ?? "");
    if (!id) return { ok: false, detail: "Paste the sheet's link: open the sheet and copy the address from your browser (it contains /spreadsheets/d/…)." };
    const tab = (config.sendTab ?? "").trim();
    if (!tab) return { ok: false, detail: "Name the tab whose new rows should be messaged." };
    try {
      const meta = await sheetMeta(id);
      if (!meta.tabs.includes(tab)) {
        return { ok: false, detail: `This sheet has no tab called “${tab}”. Its tabs are: ${meta.tabs.map(t => `“${t}”`).join(", ")}.` };
      }
      const key = `${id}|${tab}`;
      const { columns, marked } = await prepareSendTab(id, tab, config.baselineFor === key);
      const parts = [
        `Connected to “${meta.title || "your sheet"}”. New rows in “${tab}” are picked up within a few minutes; set what they're sent under Messages.`,
        ...(marked ? [`The ${marked} row${marked === 1 ? "" : "s"} already there ${marked === 1 ? "was" : "were"} marked and won't be messaged.`] : []),
      ];
      return { ok: true, detail: parts.join(" "), config: { spreadsheetId: id, sheetTitle: meta.title, sendColumns: columns.join(","), baselineFor: key } };
    } catch (err) {
      return { ok: false, detail: accessProblem(err) };
    }
  },
};
