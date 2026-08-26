import { describe, it, expect, vi, beforeEach } from "vitest";

// PostgREST caps every response at db-max-rows — 1,000 on this project — and
// .limit(50_000) does NOT raise that ceiling. Audience resolution asked for
// 50,000 and guarded truncation with `rows.length >= 50_000`, a condition that
// can never be true, so it silently sent to the first 1,000 people: a workspace
// of 1,224 active contacts sent "to all" and reached exactly 1,000.
//
// The fake below enforces the real server behaviour — no response ever exceeds
// PAGE rows, whatever was asked for.

const PAGE = 1000;
const h = vi.hoisted(() => ({
  contacts: [] as Record<string, unknown>[],
  optouts: [] as Record<string, unknown>[],
  members: [] as Record<string, unknown>[],
  batches: [{ id: "b1", tenant_id: "00000000-0000-0000-0000-000000000001", name: "Imported", kind: "static", filter: {}, archived_at: null }] as Record<string, unknown>[],
  requests: [] as string[],      // every range actually issued
  ordered: [] as (string | null)[],
}));

vi.mock("../supabase", () => {
  const table = (n: string) =>
    n === "contacts" ? h.contacts : n === "wa_optouts" ? h.optouts : n === "wa_batches" ? h.batches : h.members;
  return {
    db: () => ({
      from(name: string) {
        const filters: ((r: Record<string, unknown>) => boolean)[] = [];
        let orderKey: string | null = null, lim: number | null = null;
        const rows = () => {
          const out = table(name).filter(r => filters.every(f => f(r)));
          if (orderKey) out.sort((a, b) => String(a[orderKey!]).localeCompare(String(b[orderKey!])));
          return out;
        };
        const b: Record<string, unknown> = {
          select: () => b,
          eq: (k: string, v: unknown) => { filters.push(r => r[k] === v); return b; },
          contains: (k: string, v: unknown) => {
            filters.push(r => Array.isArray(v) ? (v as unknown[]).every(x => (r[k] as unknown[] ?? []).includes(x))
              : Object.entries(v as Record<string, unknown>).every(([kk, vv]) => ((r[k] ?? {}) as Record<string, unknown>)[kk] === vv));
            return b;
          },
          order: (k: string) => { orderKey = k; h.ordered.push(k); return b; },
          maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
          single: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
          limit: (n: number) => { lim = n; return b; },
          // The server's hard ceiling. Asking for more changes nothing.
          range: (from: number, to: number) => {
            h.requests.push(`${from}-${to}`);
            const want = Math.min(to - from + 1, PAGE);
            return Promise.resolve({ data: rows().slice(from, from + want), error: null });
          },
          then: (res: (v: unknown) => unknown) =>
            Promise.resolve({ data: rows().slice(0, Math.min(lim ?? PAGE, PAGE)), error: null }).then(res),
        };
        return b;
      },
    }),
  };
});

import { recipientsForAudience, optoutSet } from "../store";
import { resolveBatch } from "../audience";

const T = "00000000-0000-0000-0000-000000000001";

const contact = (i: number, over: Record<string, unknown> = {}) => ({
  id: `c${String(i).padStart(6, "0")}`, tenant_id: T, phone: `9190000${String(i).padStart(5, "0")}`,
  name: `P${i}`, status: "active", opted_in: true, tags: [], attributes: {}, ...over,
});

beforeEach(() => {
  h.contacts = []; h.optouts = []; h.members = []; h.requests = []; h.ordered = [];
  h.batches = [{ id: "b1", tenant_id: "00000000-0000-0000-0000-000000000001", name: "Imported", kind: "static", filter: {}, archived_at: null }];
});

describe("audience resolution reads EVERY matching contact", () => {
  it("returns all 1,224 contacts, not the first 1,000", async () => {
    h.contacts = Array.from({ length: 1224 }, (_, i) => contact(i));
    const r = await recipientsForAudience({ mode: "all" });
    expect(r).toHaveLength(1224);
  });

  it("issues more than one request to do it", async () => {
    h.contacts = Array.from({ length: 1224 }, (_, i) => contact(i));
    await recipientsForAudience({ mode: "all" });
    expect(h.requests.length).toBeGreaterThan(1);
  });

  it("orders the query, without which range paging silently repeats and skips rows", async () => {
    h.contacts = Array.from({ length: 1224 }, (_, i) => contact(i));
    await recipientsForAudience({ mode: "all" });
    expect(h.ordered).toContain("id");
  });

  it("returns every recipient exactly once across page boundaries", async () => {
    h.contacts = Array.from({ length: 2500 }, (_, i) => contact(i));
    const phones = (await recipientsForAudience({ mode: "all" })).map(r => r.phone);
    expect(phones).toHaveLength(2500);
    expect(new Set(phones).size).toBe(2500);
  });

  it("stops after one request when everything fits", async () => {
    h.contacts = Array.from({ length: 10 }, (_, i) => contact(i));
    expect(await recipientsForAudience({ mode: "all" })).toHaveLength(10);
    expect(h.requests).toHaveLength(1);
  });

  it("pages a TAG audience too, and still excludes non-matching contacts", async () => {
    h.contacts = [
      ...Array.from({ length: 1100 }, (_, i) => contact(i, { tags: ["vip"] })),
      ...Array.from({ length: 300 }, (_, i) => contact(5000 + i, { tags: ["other"] })),
    ];
    expect(await recipientsForAudience({ mode: "tag", tag: "vip" })).toHaveLength(1100);
  });

  it("never reads another tenant's contacts, however many pages it takes", async () => {
    h.contacts = [
      ...Array.from({ length: 1100 }, (_, i) => contact(i)),
      ...Array.from({ length: 400 }, (_, i) => contact(7000 + i, { tenant_id: "other-tenant" })),
    ];
    expect(await recipientsForAudience({ mode: "all" })).toHaveLength(1100);
  });

  it("excludes inactive contacts regardless of paging", async () => {
    h.contacts = [
      ...Array.from({ length: 1050 }, (_, i) => contact(i)),
      ...Array.from({ length: 200 }, (_, i) => contact(9000 + i, { status: "inactive" })),
    ];
    expect(await recipientsForAudience({ mode: "all" })).toHaveLength(1050);
  });
});

describe("the suppression list is read in full", () => {
  it("returns every opt-out past the 1,000-row ceiling", async () => {
    // A short answer here is not merely incomplete — it means messaging people
    // who asked us to stop.
    h.optouts = Array.from({ length: 1500 }, (_, i) => ({ tenant_id: T, phone: `9190000${String(i).padStart(5, "0")}` }));
    expect((await optoutSet()).size).toBe(1500);
  });

  it("keys on the last 10 digits so country-code variants suppress too", async () => {
    h.optouts = [{ tenant_id: T, phone: "918368872108" }];
    expect((await optoutSet()).has("8368872108")).toBe(true);
  });
});

describe("static batch membership is read in full", () => {
  it("resolves every member of a batch imported from a large CSV", async () => {
    h.members = Array.from({ length: 1300 }, (_, i) => ({
      batch_id: "b1", tenant_id: T, contact_id: `c${String(i).padStart(6, "0")}`,
      contacts: { phone: `9190000${String(i).padStart(5, "0")}`, name: `P${i}`, status: "active" },
    }));
    expect(await resolveBatch("b1")).toHaveLength(1300);
  });

  it("still drops members whose contact was deactivated", async () => {
    h.members = [
      { batch_id: "b1", tenant_id: T, contact_id: "c1", contacts: { phone: "919000000001", name: "A", status: "active" } },
      { batch_id: "b1", tenant_id: T, contact_id: "c2", contacts: { phone: "919000000002", name: "B", status: "inactive" } },
    ];
    expect(await resolveBatch("b1")).toHaveLength(1);
  });
});
