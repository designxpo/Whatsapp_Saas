// The retention stage (retention.ts): the right rows age out, nothing else is
// touched, and each run stays inside its bounds.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ client: null as unknown as Record<string, unknown>, touched: new Set<string>() }));
vi.mock("../supabase", () => ({ db: () => h.client }));

import { memdb, type MemDb } from "./helpers/memdb";
import { runRetention, cutoffFor, RETENTION_DAYS, RETENTION_RULES } from "../retention";

const NOW = Date.UTC(2026, 10, 1, 12, 0);
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString();
let mem: MemDb;
let n = 0;
const row = (r: Record<string, unknown>) => ({ id: `id${String(++n).padStart(6, "0")}`, ...r });
const put = (t: string, rows: Record<string, unknown>[]) => { (mem.tables[t] ??= []).push(...rows.map(row)); };
const left = (t: string) => (mem.tables[t] ?? []).length;

function missingTable(): unknown {
  const res = { data: null, error: { code: "PGRST205", message: "Could not find the table" } };
  const b: unknown = new Proxy({}, { get: (_t, k) => (k === "then" ? (ok: (v: unknown) => unknown) => Promise.resolve(res).then(ok) : () => b) });
  return b;
}
function useDb(missing: string[] = []) {
  h.client = { from: (t: string) => { h.touched.add(t); return missing.includes(t) ? missingTable() : mem.client.from(t); } };
}

beforeEach(() => {
  mem = memdb();
  h.touched.clear();
  useDb();
});

describe("retention limits", () => {
  it("computes each cutoff from the limit in days", () => {
    expect(cutoffFor(90, NOW)).toBe("2026-08-03T12:00:00.000Z");
    expect(cutoffFor(RETENTION_DAYS.deletionProof, NOW)).toBe(new Date(NOW - 1095 * 86_400_000).toISOString());
  });

  it("deletes exactly the rows past each limit", async () => {
    put("wa_session_refs", [{ created_at: ago(91) }, { created_at: ago(89) }]);
    put("wa_router_events", [{ created_at: ago(181) }, { created_at: ago(179) }]);
    put("wa_semantic_cache", [{ created_at: ago(400), last_used_at: ago(91) }, { created_at: ago(400), last_used_at: ago(10) }]);
    put("wa_ai_gaps", [
      { created_at: ago(400), resolved_at: ago(181) },   // resolved long ago → goes
      { created_at: ago(400), resolved_at: ago(100) },   // resolved recently → stays, however old the question
      { created_at: ago(366), resolved_at: null },       // never dealt with, over a year → goes
      { created_at: ago(200), resolved_at: null },       // never dealt with, under a year → stays
    ]);
    put("wa_email_log", [{ sent_at: ago(401) }, { sent_at: ago(399) }]);
    put("meta_deletion_requests", [
      { status: "completed", completed_at: ago(1096) },  // proof past 3 years → goes
      { status: "completed", completed_at: ago(700) },
      { status: "processing", completed_at: null, created_at: ago(2000) },   // unfinished is never aged out
    ]);
    put("wa_inbound_events", [{ created_at: ago(31) }, { created_at: ago(29) }]);
    put("wa_review_alerts", [{ created_at: ago(91) }, { created_at: ago(89) }]);
    put("wa_review_requests", [{ created_at: ago(401) }, { created_at: ago(399) }]);

    const r = await runRetention({ now: NOW });
    expect(r.errors).toEqual([]);
    expect(r.deleted).toEqual({
      session_refs: 1, router_events: 1, semantic_cache: 1, ai_gaps_resolved: 1, ai_gaps_open: 1,
      email_log: 1, deletion_proof: 1, inbound_events: 1, review_alerts: 1, review_requests: 1,
    });
    expect(mem.tables.wa_ai_gaps.map(g => g.resolved_at ?? g.created_at)).toEqual([ago(100), ago(200)]);
    expect(mem.tables.meta_deletion_requests.map(d => d.status)).toEqual(["completed", "processing"]);
    for (const t of ["wa_session_refs", "wa_router_events", "wa_semantic_cache", "wa_email_log", "wa_inbound_events", "wa_review_alerts", "wa_review_requests"]) expect(left(t), t).toBe(1);
  });

  it("never touches customer conversations, contacts or orders", async () => {
    put("wa_conversations", [{ created_at: ago(5000) }]);
    put("wa_conv_messages", [{ created_at: ago(5000) }]);
    put("contacts", [{ created_at: ago(5000) }]);
    put("wa_orders", [{ created_at: ago(5000) }]);
    await runRetention({ now: NOW });
    expect([...h.touched].sort()).toEqual([...new Set(RETENTION_RULES.map(r => r.table))].sort());
    expect([...h.touched].sort()).toEqual(["meta_deletion_requests", "wa_ai_gaps", "wa_email_log", "wa_inbound_events", "wa_review_alerts", "wa_review_requests", "wa_router_events", "wa_semantic_cache", "wa_session_refs"]);
    for (const t of ["wa_conversations", "wa_conv_messages", "contacts", "wa_orders"]) expect(left(t), t).toBe(1);
  });
});

describe("retention bounds", () => {
  it("deletes at most batchSize × maxBatches per table per run, and reports the backlog", async () => {
    put("wa_router_events", Array.from({ length: 25 }, () => ({ created_at: ago(200) })));
    const first = await runRetention({ now: NOW, batchSize: 10, maxBatchesPerRule: 2 });
    expect(first.deleted.router_events).toBe(20);
    expect(first.backlog).toBe(true);
    expect(left("wa_router_events")).toBe(5);

    const second = await runRetention({ now: NOW, batchSize: 10, maxBatchesPerRule: 2 });
    expect(second.deleted.router_events).toBe(5);
    expect(second.backlog).toBe(false);
  });

  it("stops at the deadline", async () => {
    put("wa_router_events", [{ created_at: ago(200) }]);
    const r = await runRetention({ now: NOW, deadlineAt: Date.now() - 1 });
    expect(r.stoppedEarly).toBe(true);
    expect(left("wa_router_events")).toBe(1);
  });

  it("skips a table that isn't migrated yet and carries on with the rest", async () => {
    useDb(["wa_ai_gaps"]);
    put("wa_email_log", [{ sent_at: ago(500) }]);
    const r = await runRetention({ now: NOW });
    expect(r.errors).toEqual([]);
    expect(r.skipped).toEqual(["ai_gaps_resolved", "ai_gaps_open"]);
    expect(r.deleted.email_log).toBe(1);
  });
});
