import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  QUEUES, QUEUE_GROUPS, QUEUE_BY_KEY, isQueueKey, queueFilters, queueNeedsMetrics,
  sanitizeSearch, searchExpr, encodeCursor, decodeCursor, cursorExpr, clampLimit,
  PAGE_SIZE, MAX_PAGE_SIZE, type QueueKey,
} from "../ownerqueues";

// A fixed instant so nothing here depends on when the suite runs.
const NOW = new Date("2026-08-16T12:00:00.000Z");

describe("queue catalog", () => {
  it("has no duplicate keys and every queue belongs to a declared group", () => {
    const keys = QUEUES.map(q => q.key);
    expect(new Set(keys).size).toBe(keys.length);
    const groups = new Set(QUEUE_GROUPS.map(g => g.key));
    for (const q of QUEUES) expect(groups.has(q.group)).toBe(true);
  });

  it("keeps money and trials on live columns, never on the refresh rotation", () => {
    // A stale "payment failed" count is worse than no count at all — these must
    // read straight off `tenants`.
    for (const k of ["payment_failed", "suspended", "trial_ending", "trial_expired"] as QueueKey[]) {
      expect(QUEUE_BY_KEY[k].source).toBe("live");
      expect(queueNeedsMetrics(k)).toBe(false);
    }
  });

  it("gives every queue a plain-language reason", () => {
    for (const q of QUEUES) {
      expect(q.why.length).toBeGreaterThan(15);
      expect(q.title.length).toBeGreaterThan(3);
    }
  });

  it("matches the queue keys owner_queue_counts() returns", () => {
    // The count comes from SQL and the rows come from queueFilters(). If the two
    // drift, a card shows a number whose list doesn't agree with it.
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/0106_owner_console.sql"), "utf8");
    const body = sql.slice(sql.indexOf("function owner_queue_counts"));
    const inSql = new Set([...body.matchAll(/^\s*select '([a-z_]+)'/gm)].map(m => m[1]));
    expect(inSql).toEqual(new Set(QUEUES.map(q => q.key)));
  });

  it("recognises only real queue keys", () => {
    expect(isQueueKey("payment_failed")).toBe(true);
    expect(isQueueKey("nope")).toBe(false);
    expect(isQueueKey("__proto__")).toBe(false);
  });
});

describe("queueFilters", () => {
  it("returns at least one filter for every queue — an empty list would match the whole fleet", () => {
    for (const q of QUEUES) expect(queueFilters(q.key, NOW).length).toBeGreaterThan(0);
  });

  it("scopes derived queues to the embedded metrics row", () => {
    for (const q of QUEUES.filter(x => x.source === "derived")) {
      const fs = queueFilters(q.key, NOW);
      const touchesMetrics = fs.some(f =>
        (f.op === "or" && f.referencedTable === "tenant_metrics") ||
        ("col" in f && f.col.startsWith("tenant_metrics.")));
      expect(touchesMetrics, `${q.key} must filter on tenant_metrics`).toBe(true);
    }
  });

  it("bounds trial_ending to the next three days", () => {
    const fs = queueFilters("trial_ending", NOW);
    expect(fs).toContainEqual({ op: "gte", col: "trial_ends_at", val: "2026-08-16T12:00:00.000Z" });
    expect(fs).toContainEqual({ op: "lte", col: "trial_ends_at", val: "2026-08-19T12:00:00.000Z" });
  });

  it("treats onboarding stalls as older than three days", () => {
    const fs = queueFilters("no_channel", NOW);
    expect(fs).toContainEqual({ op: "lt", col: "created_at", val: "2026-08-13T12:00:00.000Z" });
  });

  it("looks back a week for a silent channel, and only for tenants that have one", () => {
    const fs = queueFilters("channel_silent", NOW);
    expect(fs).toContainEqual({ op: "gt", col: "tenant_metrics.channels", val: 0 });
    expect(fs).toContainEqual({ op: "lt", col: "tenant_metrics.last_inbound_at", val: "2026-08-09T12:00:00.000Z" });
  });

  it("excludes dead accounts from queues that ask for action", () => {
    // Chasing a cancelled tenant about onboarding is noise.
    for (const k of ["no_channel", "no_ai_key", "near_limit", "trial_expired"] as QueueKey[]) {
      expect(queueFilters(k, NOW)).toContainEqual({ op: "notIn", col: "status", val: ["suspended", "cancelled"] });
    }
  });
});

describe("sanitizeSearch / searchExpr", () => {
  it("strips the PostgREST metacharacters that could break out of an or() expression", () => {
    expect(sanitizeSearch("acme,*(%_\\)")).toBe("acme");
    expect(sanitizeSearch("  spaced   out  ")).toBe("spaced out");
  });

  it("caps the length so a pasted essay can't build a pathological ILIKE", () => {
    expect(sanitizeSearch("x".repeat(500)).length).toBe(80);
  });

  it("ignores a one-character term, which would match most of the fleet", () => {
    expect(searchExpr("a")).toBeNull();
    expect(searchExpr("   ")).toBeNull();
  });

  it("searches every identifier an operator might be handed", () => {
    const e = searchExpr("acme")!;
    for (const col of ["company", "owner_email", "name", "slug", "owner_phone"]) {
      expect(e).toContain(`${col}.ilike.*acme*`);
    }
  });
});

describe("keyset pagination", () => {
  const c = { createdAt: "2026-08-16T12:00:00.000Z", id: "11111111-2222-3333-4444-555555555555" };

  it("round-trips a cursor", () => {
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
  });

  it("treats a mangled cursor as 'start from the beginning' rather than erroring", () => {
    // A truncated URL shouldn't 500 the console.
    for (const bad of ["", null, undefined, "!!!", "Zm9v", Buffer.from("notadate|x").toString("base64url")]) {
      expect(decodeCursor(bad as string)).toBeNull();
    }
  });

  it("builds a strictly-after predicate with an id tiebreaker", () => {
    // Without the tiebreaker, tenants sharing a created_at would repeat or vanish
    // across page boundaries.
    const e = cursorExpr(c);
    expect(e).toBe(`created_at.lt.${c.createdAt},and(created_at.eq.${c.createdAt},id.lt.${c.id})`);
  });

  it("clamps the page size", () => {
    expect(clampLimit(null)).toBe(PAGE_SIZE);
    expect(clampLimit("0")).toBe(PAGE_SIZE);
    expect(clampLimit("abc")).toBe(PAGE_SIZE);
    expect(clampLimit("-5")).toBe(PAGE_SIZE);
    expect(clampLimit("10")).toBe(10);
    expect(clampLimit("99999")).toBe(MAX_PAGE_SIZE);
  });
});
