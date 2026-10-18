// The dashboard range picker changed the label and nothing else.
//
// Every window shares one read of wa_send_log, and that read asked for
// `.limit(20000)`. PostgREST caps EVERY response at db-max-rows — 1,000 here —
// and .limit() does not raise that ceiling, it just asks for more than the
// server will ever hand back. So the read returned the newest 1,000 rows for
// any range wide enough to match at least 1,000.
//
// Production numbers on 2026-09-01: 3,327 log rows, history from 2026-06-16,
// and the newest 1,000 all inside the last 18 days. "30 days", "90 days" and
// "all time" therefore received the SAME 1,000 rows — identical totals,
// identical chart. Worse for "all time", whose bucket span starts at the oldest
// row RECEIVED: 77 days of history rendered as 18 days of daily bars. Only 7d
// and 14d, matching fewer than 1,000 rows, moved when you touched the picker.
//
// The fake below enforces the real server behaviour: no response ever exceeds
// PAGE rows, whatever was asked for.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { rangeStart, type RangeKey } from "../analytics-range";

const PAGE = 1000;
const NOW = new Date("2026-09-01T12:00:00Z");

const h = vi.hoisted(() => ({
  sendLog: [] as { id: string; status: string; sent_at: string }[],
  ranges: [] as string[],          // every range() actually issued on wa_send_log
  orders: [] as string[],          // order() columns, to check the sort is stable
  gtes: [] as string[],            // lower bounds applied
  limits: [] as number[],
}));

vi.mock("../supabase", () => ({
  db: () => ({
    from(name: string) {
      const filters: ((r: Record<string, unknown>) => boolean)[] = [];
      let head = false;
      const rows = () => h.sendLog.filter(r => filters.every(f => f(r as unknown as Record<string, unknown>)));
      const b: Record<string, unknown> = {
        select: (_cols?: string, opts?: { head?: boolean }) => { head = !!opts?.head; return b; },
        eq: () => b,
        gte: (k: string, v: string) => {
          if (name === "wa_send_log") h.gtes.push(`${k}>=${v}`);
          filters.push(r => String(r[k]) >= v);
          return b;
        },
        order: (k: string) => { if (name === "wa_send_log") h.orders.push(k); return b; },
        limit: (n: number) => { if (name === "wa_send_log") h.limits.push(n); return b; },
        range: (from: number, to: number) => {
          if (name === "wa_send_log") h.ranges.push(`${from}-${to}`);
          if (name !== "wa_send_log") return Promise.resolve({ data: [], error: null });
          const all = [...rows()].sort((a, z) => (a.sent_at === z.sent_at ? z.id.localeCompare(a.id) : z.sent_at.localeCompare(a.sent_at)));
          // The server's hard ceiling. Asking for more changes nothing.
          const want = Math.min(to - from + 1, PAGE);
          return Promise.resolve({ data: all.slice(from, from + want), error: null });
        },
        then: (res: (v: unknown) => unknown) => {
          if (head) return Promise.resolve({ count: 0, data: null, error: null }).then(res);
          if (name !== "wa_send_log") return Promise.resolve({ data: [], error: null }).then(res);
          // What the OLD code awaited: a plain select, capped at PAGE.
          const all = [...rows()].sort((a, z) => z.sent_at.localeCompare(a.sent_at));
          return Promise.resolve({ data: all.slice(0, PAGE), error: null }).then(res);
        },
      };
      return b;
    },
  }),
}));

// Reproduces the production distribution: dense recently, long tail behind it,
// so the newest 1,000 rows cover only the last ~18 days.
function seed() {
  const rows: { id: string; status: string; sent_at: string }[] = [];
  let n = 0;
  const add = (daysAgo: number, count: number) => {
    for (let i = 0; i < count; i++) {
      const d = new Date(NOW);
      d.setUTCDate(d.getUTCDate() - daysAgo);
      d.setUTCHours(9, 0, i % 60, 0);
      rows.push({ id: `l${String(++n).padStart(6, "0")}`, status: "delivered", sent_at: d.toISOString() });
    }
  };
  for (let d = 0; d <= 6; d++) add(d, 2);            // 14 in the last 7 days
  for (let d = 7; d <= 17; d++) add(d, 90);          // 990 more → newest 1,000 span 18 days
  for (let d = 18; d <= 76; d++) add(d, 39);         // 2,301 older, back to day 77
  return rows;
}

const inWindow = (key: RangeKey) => {
  const from = rangeStart(key, NOW);
  return from ? h.sendLog.filter(r => r.sent_at >= from.toISOString()).length : h.sendLog.length;
};

async function analytics(key: RangeKey) {
  const { getAnalytics } = await import("../store");
  return getAnalytics("00000000-0000-0000-0000-000000000001", key);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  h.sendLog = seed();
  h.ranges.length = 0; h.orders.length = 0; h.gtes.length = 0; h.limits.length = 0;
});
afterEach(() => vi.useRealTimers());

describe("range filter actually filters", () => {
  it("counts every row in the window, not the first 1,000 the server will return", async () => {
    // 3,322 rows in the last 30 days. The old read saw 1,000 of them.
    const a = await analytics("30d");
    expect(inWindow("30d")).toBeGreaterThan(PAGE);
    expect(a.messaging.totals.delivered).toBe(inWindow("30d"));
    expect(a.messaging.totals.delivered).toBeGreaterThan(PAGE);
  });

  it("gives DIFFERENT totals for 30 days and all time — the visible symptom", async () => {
    // Both matched >1,000 rows, so both were served the same newest 1,000 and
    // the two views were indistinguishable however the picker was set.
    const [thirty, all] = [await analytics("30d"), await analytics("all")];
    expect(all.messaging.totals.delivered).toBe(h.sendLog.length);
    expect(thirty.messaging.totals.delivered).toBeLessThan(all.messaging.totals.delivered);
  });

  it("still narrows correctly at the small end", async () => {
    // 7d and 14d always worked — they match fewer rows than the ceiling. Pinned
    // so the fix doesn't regress the only ranges that were fine.
    expect((await analytics("7d")).messaging.totals.delivered).toBe(14);
    expect((await analytics("14d")).messaging.totals.delivered).toBe(inWindow("14d"));
  });

  it("drops the lower bound entirely for all time", async () => {
    await analytics("all");
    expect(h.gtes).toEqual([]);
    h.gtes.length = 0;
    await analytics("90d");
    expect(h.gtes.length).toBeGreaterThan(0);
  });
});

describe("all-time bucket span", () => {
  it("starts at the oldest row that EXISTS, not the oldest row received", async () => {
    // 77 days of history is weekly territory. Reading only the newest 1,000
    // rows made the span look like 18 days, so lifetime drew daily bars over
    // less than three weeks and called it all time.
    const a = await analytics("all");
    expect(a.range.granularity).toBe("week");
    expect(a.daily.length).toBeGreaterThanOrEqual(11);
    expect(a.daily[0].date <= "2026-06-16").toBe(true);
  });

  it("keeps a short history on daily buckets", async () => {
    h.sendLog = h.sendLog.filter(r => r.sent_at >= "2026-08-25T00:00:00Z");
    const a = await analytics("all");
    expect(a.range.granularity).toBe("day");
  });
});

describe("the paged read itself", () => {
  it("pages past the ceiling instead of asking for one huge limit", async () => {
    await analytics("all");
    expect(h.ranges.length).toBeGreaterThan(1);
    // A .limit() big enough to look safe is exactly what hid this bug.
    expect(h.limits).toEqual([]);
  });

  it("sorts on a unique tiebreaker, so paging can't repeat or skip rows", async () => {
    // sent_at alone is not stable: a bulk send writes many rows on one
    // timestamp, and Postgres gives no ordering guarantee between requests.
    await analytics("all");
    expect(h.orders).toContain("sent_at");
    expect(h.orders).toContain("id");
  });

  it("counts a page boundary exactly once when timestamps collide", async () => {
    // 2,500 rows sharing one sent_at — the shape that makes an unstable sort
    // lose rows across pages.
    h.sendLog = Array.from({ length: 2500 }, (_, i) => ({
      id: `x${String(i).padStart(6, "0")}`, status: "read", sent_at: "2026-08-30T10:00:00.000Z",
    }));
    const a = await analytics("all");
    expect(a.messaging.totals.read).toBe(2500);
  });
});
