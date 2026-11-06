// @vitest-environment jsdom
// The data screens: the shared date-range control and chart read the same by
// keyboard as by mouse; Analytics keeps the old figures up while a new range
// loads and shows all four chat channels; empty Results sections say what to
// do next; the CSV exports carry what the tables show.

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ComponentType, type ReactElement } from "react";
import { createRoot } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("@/components/BrandContext", () => ({ useBrand: () => ({ partnerId: null, name: "Talko" }) }));
vi.mock("@/lib/vocab-client", () => ({ useVocab: () => ({ vocab: { contact: { one: "Contact", many: "Contacts" }, lead: { one: "Lead", many: "Leads" }, sequence: { one: "Sequence", many: "Sequences" } } }) }));

afterEach(() => { document.body.innerHTML = ""; vi.restoreAllMocks(); });

async function render(el: ReactElement) {
  const host = document.createElement("div"); document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => { root.render(el); });
  return { host, rerender: async (next: ReactElement) => { await act(async () => { root.render(next); }); } };
}
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 20)); });
const key = (el: Element, k: string) => act(async () => { el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })); });

describe("DateRange", () => {
  it("is a radio group: Tab lands on the chosen option, arrows move and choose", async () => {
    const { DateRange } = await import("@/components/date-range");
    const { presetOptions } = await import("@/lib/analytics-range");
    const onChange = vi.fn();
    const { host } = await render(createElement(DateRange, { options: presetOptions(["7d", "30d", "90d"]), value: "30d", onChange }));
    const group = host.querySelector('[role="radiogroup"]')!;
    expect(group.getAttribute("aria-label")).toBe("Date range");
    const radios = [...host.querySelectorAll('[role="radio"]')] as HTMLButtonElement[];
    expect(radios.map(r => r.getAttribute("aria-label"))).toEqual(["Last 7 days", "Last 30 days", "Last 90 days"]);
    expect(radios.map(r => r.getAttribute("aria-checked"))).toEqual(["false", "true", "false"]);
    expect(radios.map(r => r.tabIndex)).toEqual([-1, 0, -1]);
    await key(radios[1], "ArrowRight");
    expect(onChange).toHaveBeenLastCalledWith("90d");
    expect(document.activeElement).toBe(radios[2]);
    await key(radios[1], "Home");
    expect(onChange).toHaveBeenLastCalledWith("7d");
  });

  it("shows from/to dates for a custom period and says what's wrong with them", async () => {
    const { DateRange } = await import("@/components/date-range");
    const { presetOptions } = await import("@/lib/analytics-range");
    const { host } = await render(createElement(DateRange, {
      options: presetOptions(["7d", "custom"]), value: "custom", onChange: () => {},
      custom: { from: "2026-10-10", to: "2026-10-01", onChange: () => {} },
    }));
    expect(host.querySelectorAll('input[type="date"]').length).toBe(2);
    expect(host.querySelector('[role="alert"]')?.textContent).toMatch(/start date is after the end date/);
  });
});

describe("TimeChart", () => {
  it("reads each point by keyboard, and offers the numbers as a table", async () => {
    const { TimeChart, ShowAsTable, tableRows } = await import("@/components/charts");
    const points = [
      { key: "2026-11-05", label: "5 Nov", values: { sent: 1200, read: 900 } },
      { key: "2026-11-06", label: "6 Nov", values: { sent: 64, read: 40 } },
    ];
    const series = [{ key: "sent", label: "Sent", color: "#0783FD", mark: "area" as const }, { key: "read", label: "Read", color: "#084FA3", mark: "dashed" as const }];
    const { host } = await render(createElement("div", null,
      createElement(TimeChart, { points, series, label: "Messages sent" }),
      createElement(ShowAsTable, { caption: "Messages", columns: ["Day", "Sent", "Read"], rows: tableRows(points, series) })));
    const chart = host.querySelector('[aria-roledescription="chart"]') as HTMLElement;
    expect(chart.tabIndex).toBe(0);
    expect(chart.getAttribute("aria-label")).toMatch(/arrow keys/);
    await act(async () => { chart.focus(); });
    const live = () => host.querySelector('p.sr-only[aria-live="polite"]')!.textContent;
    expect(live()).toBe("6 Nov: Sent 64, Read 40");
    await key(chart, "ArrowLeft");
    expect(live()).toBe("5 Nov: Sent 1,200, Read 900");
    // Axis labels are words, not "11-05".
    expect(host.textContent).toContain("5 Nov");
    expect(host.textContent).not.toContain("11-05");

    const toggle = [...host.querySelectorAll("button")].find(b => b.textContent === "Show as table")!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await act(async () => { toggle.click(); });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const cells = [...host.querySelectorAll("table tbody tr")].map(r => r.textContent);
    expect(cells).toEqual(["5 Nov1,200900", "6 Nov6440"]);
  });
});

const analyticsPayload = (key: string, sent: number) => ({
  analytics: {
    range: { key, label: key === "7d" ? "Last 7 days" : "Last 30 days", short: key === "7d" ? "last 7 days" : "last 30 days", granularity: "day" },
    contacts: { active: 123456, optedOut: 10, newInRange: 5 },
    campaigns: { total: 0, automations: 0 },
    conversations: { total: 100, active: 90, escalated: 1, needsReply: 2, botOn: 80, whatsapp: 60, instagram: 20, messenger: 12, webchat: 8 },
    kb: { documents: 3, ready: 3 },
    messaging: { sentToday: 4, totals: { sent, delivered: 10, read: 5, failed: 1 }, repliedInRange: 2, aiRepliesInRange: 7 },
    automation: { flows: 1, flowsActive: 1, sequences: 2, sequencesActive: 1, activeEnrollments: 9 },
    recentCampaigns: [],
    daily: [{ date: "2026-11-05", sent: 6, delivered: 5, read: 2, failed: 0 }, { date: "2026-11-06", sent: 7, delivered: 5, read: 3, failed: 1 }],
  },
});

describe("Analytics", () => {
  it("shows all four channels, plain words, and keeps the old figures up while a new range loads", async () => {
    let release: (v: unknown) => void = () => {};
    globalThis.fetch = vi.fn(async (u: RequestInfo | URL) => {
      const url = String(u);
      if (url.includes("/analytics/sources")) return { ok: true, json: async () => ({ sources: null }) } as Response;
      if (url.includes("range=7d")) return new Promise<Response>(r => { release = v => r(v as Response); });
      return { ok: true, json: async () => analyticsPayload("30d", 98765) } as Response;
    }) as typeof fetch;
    const { default: AnalyticsTab } = await import("@/app/admin/_tabs/AnalyticsTab");
    const { host } = await render(createElement(AnalyticsTab, {}));
    await flush();
    const text = () => host.textContent ?? "";
    for (const ch of ["WhatsApp", "Instagram", "Messenger", "Website chat"]) expect(text()).toContain(ch);
    expect(text()).toContain("98,765 in all");
    expect(text()).toContain("1,23,456");                       // Indian grouping
    expect(text()).toContain("Follow-up messages running");
    expect(text()).toContain("Business info the AI uses");
    expect(text()).not.toMatch(/KB documents|Drip|Enrolled|Knowledge Router/);
    // Empty broadcasts → a way forward, not a dead end.
    expect([...host.querySelectorAll("button")].some(b => b.textContent === "Send your first broadcast")).toBe(true);

    const seven = host.querySelector('[role="radio"][aria-label="Last 7 days"]') as HTMLButtonElement;
    await act(async () => { seven.click(); });
    expect(text()).toContain("98,765 in all");                  // still there, not blanked
    expect(host.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(text()).toContain("Updating…");

    await act(async () => { release({ ok: true, json: async () => analyticsPayload("7d", 4321) }); });
    await flush();
    expect(text()).toContain("4,321 in all");
    expect(host.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it("delta lines say up or down in words, not only in colour", async () => {
    const { Delta } = await import("@/components/charts");
    const { host } = await render(createElement(Delta, { change: -4, unit: "points", comparison: "previous 15 days", goodWhen: "up" }));
    expect(host.textContent).toBe("▼ Down 4 points vs previous 15 days");
    expect(host.querySelector("[aria-hidden]")?.textContent?.trim()).toBe("▼");
  });

  it("channelSplit leaves out channels an older payload doesn't count", async () => {
    const { channelSplit } = await import("@/app/admin/_tabs/AnalyticsTab");
    const c = { total: 10, active: 0, escalated: 0, needsReply: 0, botOn: 0, whatsapp: 7, instagram: 3 };
    expect(channelSplit(c).map(x => x.label)).toEqual(["WhatsApp", "Instagram"]);
    expect(channelSplit({ ...c, messenger: 0, webchat: 2 }).map(x => x.label)).toEqual(["WhatsApp", "Instagram", "Messenger", "Website chat"]);
  });

  it("messagePoints labels days, weeks and months in words", async () => {
    const { messagePoints } = await import("@/app/admin/_tabs/AnalyticsTab");
    const now = new Date().getFullYear();
    const wk = messagePoints({ range: { key: "90d", label: "", short: "", granularity: "week" }, daily: [{ date: `${now}-11-02`, sent: 1, delivered: 1, read: 1, failed: 0 }] });
    expect(wk[0].label).toBe("2 Nov");
    expect(wk[0].title).toBe("Week of 2 Nov");
    const mo = messagePoints({ range: { key: "all", label: "", short: "", granularity: "month" }, daily: [{ date: "2026-03", sent: 1, delivered: 1, read: 1, failed: 0 }] });
    expect(mo[0].label).toBe("Mar 2026");
  });
});

const emptyResults = { days: 30, revenueCents: 0, paidOrders: 0, currency: "INR", bySource: [], ads: [], broadcasts: [], social: [], aiReads: null, missed: { readyNotPaid: 0, unpaidOrders: 0, unpaidValueCents: 0 } };

describe("Results", () => {
  it("each empty section explains how it fills and links to the right screen", async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => emptyResults }) as Response) as typeof fetch;
    const { default: ResultsTab } = await import("@/app/admin/_tabs/ResultsTab");
    const goTo = vi.fn();
    const { host } = await render(createElement(ResultsTab as unknown as ComponentType<{ goTo: unknown }>, { goTo }));
    await flush();
    expect(host.textContent).toContain("No paid orders in this period yet");
    const labels = [...host.querySelectorAll("button")].map(b => b.textContent);
    expect(labels).toEqual(expect.arrayContaining(["Set up payment in chat", "Go to Meta Ads", "Send a broadcast", "Set up Instagram comment replies", "Open Live Chat"]));
    await act(async () => { [...host.querySelectorAll("button")].find(b => b.textContent === "Send a broadcast")!.click(); });
    expect(goTo).toHaveBeenCalledWith("broadcast");
    expect(host.textContent).toContain("₹0");
  });

  it("the CSV carries every table, money in rupees", async () => {
    const { resultsCsvSections } = await import("@/app/admin/_tabs/ResultsTab");
    const s = resultsCsvSections({ ...emptyResults, revenueCents: 1245050000, paidOrders: 2, bySource: [{ channel: "Instagram", orders: 2, revenueCents: 1245050000, fromCustomerRecord: 0 }] });
    expect(s.map(x => x.title)).toEqual(["Summary — last 30 days", "Where paying customers came from", "Meta ads to leads to sales", "Broadcasts to orders (bought within 7 days)", "Social comments to WhatsApp to sales"]);
    expect(s[0].rows[0]).toEqual(["Revenue (INR)", 12450500]);
    expect(s[1].rows).toEqual([["Instagram", 2, 12450500]]);
  });
});

describe("Team Progress CSV", () => {
  it("has the same columns as the table, with the team only when showing every team", async () => {
    const { progressCsv } = await import("@/app/admin/_tabs/TeamProgressTab");
    const row = { key: "r", team: "sales" as const, who: "Karan", channelName: "Line 1", shared: false, open: 4, waiting: 1, escalated: 0, activeInRange: 9, repliedInRange: 3, humanReplies: 12, won: 2, lost: 1 };
    const one = progressCsv([row], false);
    expect(one.header).toEqual(["Who", "Line", "Waiting on us", "Open", "Handed to a person", "Active in period", "Replies by a person", "Won", "Lost"]);
    expect(one.rows[0]).toEqual(["Karan", "Line 1", 1, 4, 0, 9, 12, 2, 1]);
    const all = progressCsv([{ ...row, shared: true }], true);
    expect(all.header[2]).toBe("Team");
    expect(all.rows[0][1]).toBe("Shared line — nobody assigned");
  });
});
