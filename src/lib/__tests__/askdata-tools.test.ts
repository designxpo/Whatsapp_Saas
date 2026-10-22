import { describe, it, expect, vi, beforeEach } from "vitest";

// The read-only tools behind "Ask your data".
//
// The model never writes a query. It picks one of these tools and fills in its
// arguments; the server validates them and runs a fixed, workspace-filtered
// count. So the worst a confused model can do is ask for the wrong count — and
// every answer shows which counts it used.

const h = vi.hoisted(() => ({
  calls: [] as { table: string; ops: [string, ...unknown[]][] }[],
  count: 7,
  rows: [] as Record<string, unknown>[],
}));

vi.mock("../supabase", () => {
  const chain = (table: string) => {
    const rec = { table, ops: [] as [string, ...unknown[]][] };
    h.calls.push(rec);
    const o: Record<string, unknown> = {};
    for (const op of ["select", "eq", "neq", "gte", "lt", "ilike", "or", "in", "order", "range", "not", "is"]) {
      o[op] = (...a: unknown[]) => { rec.ops.push([op, ...a]); return o; };
    }
    o.then = (res: (v: unknown) => unknown) => {
      // A status-filtered count is answered from the rows, so broadcast_stats
      // can be checked without a real database.
      const st = rec.ops.find(([op, col]) => (op === "in" || op === "eq") && col === "status");
      const count = st
        ? h.rows.filter(r => (st[0] === "in" ? (st[2] as string[]).includes(r.status as string) : r.status === st[2])).length
        : h.count;
      return Promise.resolve({ data: h.rows, count, error: null }).then(res);
    };
    return o;
  };
  return { db: () => ({ from: (t: string) => chain(t) }) };
});
vi.mock("../channels", () => ({
  // listChannels(tenantId) filters by workspace in the database; the double
  // keeps that contract so a test can see which workspace was asked for.
  listChannels: async (tid?: string) => [
    { id: "ch-ppc", name: "PPC SM", kind: "whatsapp", active: true, tenantId: "tenant-1" },
    { id: "ch-org", name: "Organic", kind: "whatsapp", active: true, tenantId: "tenant-1" },
    { id: "ch-x", name: "Other Business", kind: "whatsapp", active: true, tenantId: "tenant-2" },
  ].filter(c => !tid || c.tenantId === tid),
}));

const { dayRange, runTool, ASK_TOOLS } = await import("../askdata-tools");

beforeEach(() => { h.calls = []; h.count = 7; h.rows = []; });

const T = "tenant-1";
const tenantFiltered = () => h.calls.every(c => c.ops.some(([op, col, val]) => op === "eq" && col === "tenant_id" && val === "tenant-1"));

describe("dayRange", () => {
  it("reads dates as India business days, with an inclusive end", () => {
    const r = dayRange("2026-10-14", "2026-10-21");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 00:00 IST is 18:30 UTC the day before.
    expect(r.from).toBe("2026-10-13T18:30:00.000Z");
    expect(r.to).toBe("2026-10-21T18:30:00.000Z");
  });
  it("refuses a malformed date, or an end before the start", () => {
    expect(dayRange("14/10/2026", "2026-10-21").ok).toBe(false);
    expect(dayRange("2026-10-21", "2026-10-14").ok).toBe(false);
  });
});

describe("runTool", () => {
  it("counts leads in a range, filtered to the workspace", async () => {
    const r = await runTool("count_leads", { from: "2026-10-14", to: "2026-10-21", city: "Noida" }, T);
    expect(r).toMatchObject({ ok: true, result: { count: 7 } });
    expect(tenantFiltered()).toBe(true);
    expect(h.calls[0].ops).toContainEqual(["ilike", "attributes->>city", "%Noida%"]);
    expect((r as { description: string }).description).toMatch(/Noida/);
  });

  it("resolves a number by name, and lists the real names when it cannot", async () => {
    // Tools take strings on every provider, so "yes" means waiting.
    const ok = await runTool("count_conversations", { waiting: "yes", number: "ppc sm" }, T);
    expect(ok.ok).toBe(true);
    expect(h.calls.at(-1)!.ops).toContainEqual(["eq", "channel_id", "ch-ppc"]);
    const bad = await runTool("count_conversations", { number: "Nobody" }, T);
    expect(bad).toMatchObject({ ok: false });
    expect((bad as { error: string }).error).toContain("PPC SM");
  });

  it("counts broadcast outcomes cumulatively — a read message was also delivered and sent", async () => {
    h.rows = [{ status: "read" }, { status: "read" }, { status: "delivered" }, { status: "sent" }, { status: "failed" }];
    const r = await runTool("broadcast_stats", { from: "2026-10-14", to: "2026-10-21" }, T);
    expect(r).toMatchObject({ ok: true, result: { sent: 4, delivered: 3, read: 2, failed: 1 } });
    expect(tenantFiltered()).toBe(true);
  });

  it("breaks leads down by a field, largest first", async () => {
    h.rows = [
      { source: "PPC-whatsapp", attributes: {} }, { source: "PPC-whatsapp", attributes: {} },
      { source: null, attributes: { lsq_source: "Website" } },
    ];
    const r = await runTool("lead_breakdown", { from: "2026-10-14", to: "2026-10-21", by: "source" }, T);
    expect(r).toMatchObject({ ok: true, result: { groups: [{ value: "PPC-whatsapp", count: 2 }, { value: "Website", count: 1 }] } });
  });

  it("never lists or resolves another workspace's number", async () => {
    const list = await runTool("list_numbers", {}, T);
    expect(JSON.stringify(list)).not.toContain("Other Business");
    const r = await runTool("count_conversations", { number: "Other Business" }, T);
    expect(r).toMatchObject({ ok: false });
    // The name asked for is echoed back; the list it offers instead is this workspace's.
    expect((r as { error: string }).error).toContain("The numbers are: PPC SM, Organic.");
  });

  it("rejects an unknown tool and bad arguments rather than guessing", async () => {
    expect(await runTool("drop_table", {}, T)).toMatchObject({ ok: false });
    expect(await runTool("count_leads", { from: "yesterday", to: "today" }, T)).toMatchObject({ ok: false });
    expect(await runTool("count_messages", { kind: "everything", from: "2026-10-14", to: "2026-10-21" }, T)).toMatchObject({ ok: false });
    expect(h.calls).toHaveLength(0);
  });

  it("declares exactly the tools it can run", () => {
    expect(ASK_TOOLS.map(t => t.name).sort()).toEqual(
      ["broadcast_stats", "count_conversations", "count_leads", "count_messages", "drip_stats", "lead_breakdown", "list_numbers"]);
  });
});
