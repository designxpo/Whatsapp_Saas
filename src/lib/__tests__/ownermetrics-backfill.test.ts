// Every tenant needs a tenant_metrics row, or the fleet sweep never reaches it
// and the owner console shows "—" for its Health, Contacts and Last inbound
// forever. The rows are seeded by the SQL function owner_backfill_metrics
// (0106) — which production turned out not to have (PGRST202, 2026-10-30), so
// no tenant who signed up after the console shipped ever got one. A missing
// function must fall back to doing the same insert, not give up.
import { describe, it, expect, vi, beforeEach } from "vitest";

type Call = { table: string; op: string; payload?: unknown; opts?: unknown; inFilter?: unknown[] };
const calls: Call[] = [];
let rpcError: { message: string } | null = null;
let tenants: { id: string }[] = [];
let metrics: { tenant_id: string }[] = [];

function builder(table: string) {
  const c: Call = { table, op: "select" };
  calls.push(c);
  const b: Record<string, unknown> = {};
  const chain = (fn: (...a: unknown[]) => void) => (...a: unknown[]) => { fn(...a); return b; };
  for (const m of ["select", "order", "limit"]) b[m] = chain(() => {});
  b.in = chain((_col, v) => { c.inFilter = v as unknown[]; });
  b.upsert = chain((p, o) => { c.op = "upsert"; c.payload = p; c.opts = o; });
  b.then = (res: (v: unknown) => unknown) => Promise.resolve({
    data: c.op !== "select" ? null : table === "tenants" ? tenants : metrics.filter(m => !c.inFilter || c.inFilter.includes(m.tenant_id)),
    error: null,
  }).then(res);
  return b;
}
vi.mock("../supabase", () => ({
  db: () => ({
    from: (t: string) => builder(t),
    rpc: async () => (rpcError ? { data: null, error: rpcError } : { data: 3, error: null }),
  }),
}));

import { backfillMetricsRows } from "../ownermetrics";

beforeEach(() => { calls.length = 0; rpcError = null; tenants = []; metrics = []; });

describe("seeding a metrics row for every tenant", () => {
  it("uses the SQL function when it exists", async () => {
    expect(await backfillMetricsRows()).toBe(3);
    expect(calls.length).toBe(0);
  });

  it("falls back to inserting the missing rows itself when the function is missing", async () => {
    rpcError = { message: "Could not find the function public.owner_backfill_metrics without parameters in the schema cache" };
    tenants = [{ id: "t1" }, { id: "t2" }, { id: "t3" }];
    metrics = [{ tenant_id: "t2" }];
    expect(await backfillMetricsRows()).toBe(2);
    const up = calls.find(c => c.op === "upsert")!;
    expect(up.table).toBe("tenant_metrics");
    // Only the missing ones, at epoch so the rotation takes them first, never overwriting a row.
    expect(up.payload).toEqual([
      { tenant_id: "t1", refreshed_at: "1970-01-01T00:00:00.000Z" },
      { tenant_id: "t3", refreshed_at: "1970-01-01T00:00:00.000Z" },
    ]);
    expect(up.opts).toMatchObject({ onConflict: "tenant_id", ignoreDuplicates: true });
  });

  it("writes nothing when every tenant already has a row", async () => {
    rpcError = { message: "missing" };
    tenants = [{ id: "t1" }];
    metrics = [{ tenant_id: "t1" }];
    expect(await backfillMetricsRows()).toBe(0);
    expect(calls.some(c => c.op === "upsert")).toBe(false);
  });
});
