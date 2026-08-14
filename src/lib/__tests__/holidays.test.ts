import { describe, it, expect, vi, afterEach } from "vitest";
import { getHolidays, holidayOn, upcomingHolidays } from "../holidays";

const res = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

// Nager.Date-shaped rows. Unique country codes per test so the in-memory cache
// (keyed country+year) never bleeds between cases.
const rows = (year: number) => [
  { date: `${year}-01-26`, name: "Republic Day", localName: "Republic Day" },
  { date: `${year}-03-14`, name: "Holi", localName: "Holi" },
  { date: `${year}-11-08`, name: "Diwali", localName: "Deepavali" },
  { date: "bad-date", name: "Ignored" },   // filtered out
];

afterEach(() => vi.unstubAllGlobals());

describe("holidays", () => {
  it("getHolidays maps rows and drops malformed dates", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => res(200, rows(2026))));
    const hs = await getHolidays(2026, "T1");
    expect(hs).toHaveLength(3);
    expect(hs[1]).toEqual({ date: "2026-03-14", name: "Holi", localName: "Holi" });
  });

  it("getHolidays returns [] on HTTP error (best-effort)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => res(500, {})));
    expect(await getHolidays(2026, "T2")).toEqual([]);
  });

  it("holidayOn matches a calendar date (accepts an ISO timestamp too)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => res(200, rows(2026))));
    expect((await holidayOn("2026-11-08", "T3"))?.name).toBe("Diwali");
    expect((await holidayOn("2026-11-08T10:00:00", "T3"))?.name).toBe("Diwali");
    expect(await holidayOn("2026-11-09", "T3")).toBeNull();
  });

  it("upcomingHolidays returns future holidays in-window with daysAway, sorted", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => res(200, rows(2026))));
    const up = await upcomingHolidays("T4", 90, "2026-03-01T00:00:00Z");
    expect(up.map(h => h.name)).toEqual(["Holi"]); // Diwali is >90 days out; Republic Day already passed
    expect(up[0].daysAway).toBe(13);
  });
});
