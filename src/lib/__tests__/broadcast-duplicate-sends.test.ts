import { describe, it, expect, vi, beforeEach } from "vitest";

// Sending the same broadcast twice is the one delivery bug a customer always
// notices and Meta always charges for. Migration 0044 made the claim atomic in
// the database, but claimPending's FALLBACK — taken whenever that RPC is absent
// or errors — was a plain SELECT of status='pending' rows. Rows only leave
// 'pending' AFTER the chunk has gone to Meta, so a bare read is not a claim, and
// every overlapping drain re-sent the same people. The internal build ran on
// exactly that code and put 1,739 duplicate marketing templates on real phones.
//
// The fake models the one Postgres guarantee both paths rest on: under READ
// COMMITTED an UPDATE re-evaluates its WHERE clause after taking the row lock,
// so a row a concurrent writer already claimed no longer matches and is skipped.

interface QRow { id: string; campaign_id: string; phone: string; recipient_name: string; status: string; claimed_at: string | null; created_at: string; [k: string]: unknown }
interface LRow { tenant_id: string; campaign_id: string; phone: string; status: string; [k: string]: unknown }

const T = "00000000-0000-0000-0000-000000000001";

const h = vi.hoisted(() => ({
  queue: [] as QRow[],
  log: [] as LRow[],
  rpcAvailable: false,       // migration 0044 deployed?
  claimedAtColumn: true,     // pre-0044 schemas have no claimed_at
  updateCalls: 0,
}));

function matches(row: Record<string, unknown>, f: { eq: [string, unknown][]; inList: [string, unknown[]][]; or: string | null }): boolean {
  for (const [k, v] of f.eq) if (row[k] !== v) return false;
  for (const [k, vs] of f.inList) if (!vs.includes(row[k])) return false;
  if (f.or) {
    const ok = f.or.split(",").some(clause => {
      if (clause === "claimed_at.is.null") return row.claimed_at === null;
      const lt = clause.match(/^claimed_at\.lt\.(.+)$/);
      if (lt) return row.claimed_at !== null && String(row.claimed_at) < lt[1];
      const like = clause.match(/^phone\.like\.\*(.+)$/);
      if (like) return String(row.phone).endsWith(like[1]);
      return false;
    });
    if (!ok) return false;
  }
  return true;
}

const MISSING_COL = { message: 'column wa_send_queue.claimed_at does not exist' };

vi.mock("../supabase", () => {
  const table = (name: string) => (name === "wa_send_queue" ? h.queue : h.log) as Record<string, unknown>[];
  return {
    db: () => ({
      rpc: async (_fn: string, _args: unknown) =>
        h.rpcAvailable
          ? { data: (() => { const hit = h.queue.filter(r => r.status === "pending" && r.claimed_at === null); for (const r of hit) r.claimed_at = new Date().toISOString(); return hit.map(r => ({ id: r.id, phone: r.phone, recipient_name: r.recipient_name })); })(), error: null }
          : { data: null, error: { message: "function claim_send_queue does not exist" } },
      from(name: string) {
        const f = { eq: [] as [string, unknown][], inList: [] as [string, unknown[]][], or: null as string | null };
        let orderKey = "id", lim = Infinity, rangeFrom = 0, rangeTo = Infinity;
        const touchesClaimedAt = () => !!f.or?.includes("claimed_at");
        const rows = () => {
          const out = table(name).filter(r => matches(r, f));
          out.sort((a, b) => String(a[orderKey]).localeCompare(String(b[orderKey])));
          return out.slice(rangeFrom, Math.min(rangeTo + 1, rangeFrom + lim));
        };
        const b: Record<string, unknown> = {
          eq(k: string, v: unknown) { f.eq.push([k, v]); return b; },
          in(k: string, v: unknown[]) { f.inList.push([k, v]); return b; },
          // PostgREST keeps chaining and surfaces an unknown column on await,
          // so the error must appear there — not from the builder call.
          or(s: string) { f.or = s; return b; },
          order(k: string) { orderKey = k; return b; },
          limit(n: number) { lim = n; return b; },
          range(a: number, z: number) { rangeFrom = a; rangeTo = z; return b; },
          select(_c?: string, opts?: { count?: string; head?: boolean }) {
            if (opts?.head) {
              b.then = (res: (v: unknown) => unknown) => Promise.resolve(
                !h.claimedAtColumn && touchesClaimedAt() ? { count: null, error: MISSING_COL } : { count: rows().length, error: null },
              ).then(res);
            }
            return b;
          },
          update(patch: Record<string, unknown>) {
            const u: Record<string, unknown> = {
              eq(k: string, v: unknown) { f.eq.push([k, v]); return u; },
              in(k: string, v: unknown[]) { f.inList.push([k, v]); return u; },
              or(s: string) { f.or = s; return u; },
              // Resolves asynchronously and re-checks the predicate at that
              // moment — where the race is actually won or lost.
              select() {
                return Promise.resolve().then(() => {
                  if (!h.claimedAtColumn && (touchesClaimedAt() || "claimed_at" in patch)) return { data: null, error: MISSING_COL };
                  h.updateCalls++;
                  const hit = table(name).filter(r => matches(r, f));
                  for (const r of hit) Object.assign(r, patch);
                  return { data: hit.map(r => ({ ...r })), error: null };
                });
              },
              then(res: (v: unknown) => unknown) {
                return Promise.resolve().then(() => {
                  for (const r of table(name).filter(rr => matches(rr, f))) Object.assign(r, patch);
                  return { error: null };
                }).then(res);
              },
            };
            return u;
          },
          then(res: (v: unknown) => unknown) {
            return Promise.resolve(
              !h.claimedAtColumn && touchesClaimedAt() ? { data: null, error: MISSING_COL } : { data: rows().map(r => ({ ...r })), error: null },
            ).then(res);
          },
        };
        return b;
      },
    }),
  };
});

import { claimPending, phonesAlreadySent, countPending, campaignFunnel, logCounts } from "../store";

const C = "camp-1";
function seedQueue(n: number, opts: { claimedAt?: string | null } = {}) {
  h.queue = Array.from({ length: n }, (_, i) => ({
    id: `q${String(i).padStart(3, "0")}`,
    campaign_id: C,
    phone: `9199990000${String(i).padStart(2, "0")}`,
    recipient_name: `P${i}`,
    status: "pending",
    claimed_at: opts.claimedAt ?? null,
    created_at: `2026-08-13T08:00:${String(i).padStart(2, "0")}.000Z`,
  }));
}

beforeEach(() => {
  h.queue = []; h.log = []; h.updateCalls = 0;
  h.rpcAvailable = false; h.claimedAtColumn = true;
});

describe("the fallback claim is a claim, not a read", () => {
  it("two concurrent drains never claim the same recipient", async () => {
    seedQueue(10);
    const [a, b] = await Promise.all([claimPending(C, 10), claimPending(C, 10)]);
    const ids = [...a, ...b].map(r => r.id);
    expect(ids.length).toBe(10);
    expect(new Set(ids).size).toBe(10);
  });

  it("five overlapping drains still hand each recipient to exactly one", async () => {
    seedQueue(80);
    const claims = await Promise.all(Array.from({ length: 5 }, () => claimPending(C, 80)));
    expect(claims.flat()).toHaveLength(80);
    expect(claims.filter(c => c.length > 0)).toHaveLength(1);
  });

  it("stamps claimed_at and leaves status at 'pending'", async () => {
    seedQueue(3);
    await claimPending(C, 3);
    expect(h.queue.every(r => r.status === "pending" && r.claimed_at !== null)).toBe(true);
  });

  it("sends NOTHING rather than risk duplicates on a pre-0044 schema", async () => {
    // A stalled queue is recoverable; a duplicated marketing blast is not.
    h.claimedAtColumn = false;
    seedQueue(5);
    expect(await claimPending(C, 5)).toEqual([]);
  });

  it("prefers the atomic RPC when migration 0044 is deployed", async () => {
    h.rpcAvailable = true;
    seedQueue(4);
    expect(await claimPending(C, 4)).toHaveLength(4);
    expect(h.updateCalls).toBe(0);          // never reached the fallback
  });

  it("does not touch the queue when nothing is claimable", async () => {
    seedQueue(2, { claimedAt: new Date().toISOString() });
    expect(await claimPending(C, 5)).toEqual([]);
    expect(h.updateCalls).toBe(0);
  });
});

describe("a claim expires so a dead drain cannot strand recipients", () => {
  it("a fresh claim is not re-claimable", async () => {
    seedQueue(4, { claimedAt: new Date(Date.now() - 60_000).toISOString() });
    expect(await claimPending(C, 4)).toEqual([]);
  });

  it("a claim past the TTL is taken back", async () => {
    seedQueue(4, { claimedAt: new Date(Date.now() - 20 * 60_000).toISOString() });
    expect(await claimPending(C, 4)).toHaveLength(4);
  });

  it("countPending treats in-flight work as neither remaining nor lost", async () => {
    seedQueue(6);
    expect(await countPending(C)).toBe(6);
    await claimPending(C, 6);
    expect(await countPending(C)).toBe(0);
    for (const r of h.queue) r.claimed_at = new Date(Date.now() - 20 * 60_000).toISOString();
    expect(await countPending(C)).toBe(6);
  });

  it("countPending degrades to the plain pending count pre-0044", async () => {
    h.claimedAtColumn = false;
    seedQueue(6);
    expect(await countPending(C)).toBe(6);
  });
});

describe("phonesAlreadySent — the guard behind the claim", () => {
  it("matches a stored country-coded log row against a 10-digit queue phone", async () => {
    h.log = [{ tenant_id: T, campaign_id: C, phone: "918368872108", status: "sent" }];
    expect([...await phonesAlreadySent(C, ["8368872108"])]).toEqual(["8368872108"]);
  });

  it("ignores a 'skipped' row — nothing was sent, so a later attempt is legitimate", async () => {
    h.log = [{ tenant_id: T, campaign_id: C, phone: "919999000001", status: "skipped" }];
    expect((await phonesAlreadySent(C, ["919999000001"])).size).toBe(0);
  });

  it("counts a 'failed' row — Meta was already charged for the attempt", async () => {
    h.log = [{ tenant_id: T, campaign_id: C, phone: "919999000001", status: "failed" }];
    expect((await phonesAlreadySent(C, ["919999000001"])).size).toBe(1);
  });

  it("never reads across tenants", async () => {
    h.log = [{ tenant_id: "other-tenant", campaign_id: C, phone: "919999000001", status: "sent" }];
    expect((await phonesAlreadySent(C, ["919999000001"], T)).size).toBe(0);
  });
});

describe("the funnel counts people, not log rows", () => {
  it("five sends to one phone are one person, not five", async () => {
    h.log = Array.from({ length: 5 }, () => ({ tenant_id: T, campaign_id: C, phone: "919999021666", status: "sent" }));
    expect(await campaignFunnel(C)).toMatchObject({ total: 1, sent: 1 });
  });

  it("keeps each person in their furthest bucket only", async () => {
    h.log = [
      { tenant_id: T, campaign_id: C, phone: "919999000001", status: "sent" },
      { tenant_id: T, campaign_id: C, phone: "919999000001", status: "read" },
      { tenant_id: T, campaign_id: C, phone: "919999000002", status: "delivered" },
      { tenant_id: T, campaign_id: C, phone: "919999000003", status: "failed" },
    ];
    expect(await campaignFunnel(C)).toMatchObject({ total: 3, read: 1, delivered: 1, sent: 0, failed: 1 });
  });

  it("agrees with logCounts on how many were reached", async () => {
    h.log = [
      { tenant_id: T, campaign_id: C, phone: "919999000001", status: "sent" },
      { tenant_id: T, campaign_id: C, phone: "919999000001", status: "sent" },
      { tenant_id: T, campaign_id: C, phone: "919999000002", status: "read" },
    ];
    const f = await campaignFunnel(C);
    expect(f.sent + f.delivered + f.read).toBe((await logCounts(C)).sent);
  });

  it("pages past the row cap PostgREST applies to an unbounded select", async () => {
    h.log = Array.from({ length: 1431 }, (_, i) => ({
      tenant_id: T, campaign_id: C, phone: `9199${String(i).padStart(8, "0")}`, status: "sent",
    }));
    expect((await logCounts(C)).sent).toBe(1431);
  });
});
