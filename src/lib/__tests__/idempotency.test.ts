import { describe, it, expect, vi, beforeEach } from "vitest";

// /api/events receipts: a caller retrying with the same Idempotency-Key gets
// the first answer and nothing is sent twice. An in-memory stand-in for the
// wa_api_event_receipts table, scoped by tenant like tdb() scopes it.

type Row = { tenant_id: string; idem_key: string; request_hash: string; status_code: number | null; response: unknown; created_at: string };
const rows: Row[] = [];

vi.mock("@/lib/tenantdb", () => ({
  tdb: (tenantId: string) => ({
    from: () => {
      const mine = () => rows.filter(r => r.tenant_id === tenantId);
      return {
        insert: async (v: { idem_key: string; request_hash: string }) => {
          if (mine().some(r => r.idem_key === v.idem_key)) return { error: { code: "23505", message: "duplicate" } };
          rows.push({ tenant_id: tenantId, status_code: null, response: null, created_at: new Date().toISOString(), ...v });
          return { error: null };
        },
        select: () => ({ eq: (_c: string, key: string) => ({ maybeSingle: async () => ({ data: mine().find(r => r.idem_key === key) ?? null }) }) }),
        update: (v: Partial<Row>) => {
          const filters: ((r: Row) => boolean)[] = [];
          const chain = {
            eq: (_c: string, key: string) => { filters.push(r => r.idem_key === key); return chain; },
            is: () => { filters.push(r => r.status_code === null); return chain; },
            lt: (_c: string, iso: string) => { filters.push(r => r.created_at < iso); return chain; },
            select: async () => { const hit = mine().filter(r => filters.every(f => f(r))); hit.forEach(r => Object.assign(r, v)); return { data: hit }; },
            then: (ok: (x: unknown) => unknown, bad: (e: unknown) => unknown) => chain.select().then(ok, bad),
          };
          return chain;
        },
        delete: () => ({ eq: (_c: string, key: string) => ({ then: (ok: (x: unknown) => unknown) => { const i = rows.findIndex(r => r.tenant_id === tenantId && r.idem_key === key); if (i >= 0) rows.splice(i, 1); return Promise.resolve(ok(undefined)); } }) }),
      };
    },
  }),
}));

import { claimIdempotency, completeIdempotency } from "../idempotency";

beforeEach(() => { rows.length = 0; });

describe("event receipts", () => {
  it("replays the first answer for a retry with the same key and body", async () => {
    expect(await claimIdempotency("t1", "key-12345678", "h1")).toEqual({ kind: "new" });
    expect(await claimIdempotency("t1", "key-12345678", "h1")).toEqual({ kind: "busy" });
    await completeIdempotency("t1", "key-12345678", 200, { success: true, scheduled: 1 });
    expect(await claimIdempotency("t1", "key-12345678", "h1")).toEqual({ kind: "replay", status: 200, body: { success: true, scheduled: 1 } });
  });

  it("refuses the same key for a different request", async () => {
    await claimIdempotency("t1", "key-12345678", "h1");
    await completeIdempotency("t1", "key-12345678", 200, {});
    expect(await claimIdempotency("t1", "key-12345678", "h2")).toEqual({ kind: "mismatch" });
  });

  it("keeps tenants apart: one tenant's key never replays for another", async () => {
    await claimIdempotency("t1", "key-12345678", "h1");
    await completeIdempotency("t1", "key-12345678", 200, { tenant: "t1" });
    expect(await claimIdempotency("t2", "key-12345678", "h1")).toEqual({ kind: "new" });
  });

  it("lets a retry run for real after a server error", async () => {
    await claimIdempotency("t1", "key-12345678", "h1");
    await completeIdempotency("t1", "key-12345678", 500, { error: "boom" });
    expect(await claimIdempotency("t1", "key-12345678", "h1")).toEqual({ kind: "new" });
  });

  it("takes over a claim abandoned by a crashed request", async () => {
    await claimIdempotency("t1", "key-12345678", "h1");
    rows[0].created_at = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(await claimIdempotency("t1", "key-12345678", "h1")).toEqual({ kind: "new" });
  });
});
