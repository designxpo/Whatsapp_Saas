import { describe, it, expect, vi, beforeEach } from "vitest";

// Batches: named, tenant-scoped broadcast audiences — migration 0112.
//
// The behaviours worth pinning down are the ones where a mistake sends to the
// wrong people, or leaks one workspace's contacts into another's audience.
//
// Consent is NOT redefined for batches: this schema already carries
// contacts.opted_in and every broadcast resolves with onlyOptedIn, so these
// tests cover membership, tenancy and the shortfall REPORT only.
type Row = Record<string, unknown>;

const tables: Record<string, Row[]> = {};
const table = (n: string) => (tables[n] ??= []);
let seq = 0;
/** Records every write so a test can assert what the ledger actually got. */
const writes: { table: string; op: string; payload: unknown }[] = [];
/** Set to a table name to make its inserts fail. */
let failInsertOn: string | null = null;

function makeQuery(name: string, rows: Row[]) {
  const filters: ((r: Row) => boolean)[] = [];
  let cols: string[] = [];
  let rangeFrom = -1, rangeTo = -1;
  const q = {
    select(c?: string, opts?: { count?: string; head?: boolean }) {
      cols = (c ?? "").split(",").map(s => s.trim()).filter(Boolean);
      if (opts?.head) {
        return { ...q, then: (res: (v: unknown) => void) => res({ count: rows.filter(r => filters.every(f => f(r))).length, error: null }) };
      }
      return q;
    },
    eq(k: string, v: unknown) { filters.push(r => r[k] === v); return q; },
    is(k: string, v: null) { filters.push(r => (r[k] ?? null) === v); return q; },
    not(k: string, _op: string, _v: null) { filters.push(r => (r[k] ?? null) !== null); return q; },
    in(k: string, vs: unknown[]) { filters.push(r => vs.includes(r[k])); return q; },
    contains(k: string, v: unknown) {
      filters.push(r => {
        const cur = r[k];
        if (Array.isArray(v)) return Array.isArray(cur) && v.every(x => (cur as unknown[]).includes(x));
        const obj = (cur ?? {}) as Record<string, unknown>;
        return Object.entries(v as Record<string, unknown>).every(([kk, vv]) => obj[kk] === vv);
      });
      return q;
    },
    order() { return q; },
    limit() { return q; },
    range(from: number, to: number) { rangeFrom = from; rangeTo = to; return q; },
    like(k: string, pattern: string) {
      const needle = pattern.replace(/%/g, "");
      filters.push(r => String(r[k] ?? "").endsWith(needle));
      return q;
    },
    // PostgREST or() with like patterns: "phone.like.*123,phone.like.*456"
    or(expr: string) {
      const needles = expr.split(",").map(e => e.split(".like.*")[1]).filter(Boolean);
      filters.push(r => needles.some(n => String(r.phone ?? "").endsWith(n)));
      return q;
    },
    async maybeSingle() {
      const hit = rows.filter(r => filters.every(f => f(r)))[0];
      return { data: hit ? { ...hit } : null, error: null };
    },
    async single() {
      const hit = rows.filter(r => filters.every(f => f(r)))[0];
      return hit ? { data: { ...hit }, error: null } : { data: null, error: { message: "no rows" } };
    },
    then(res: (v: { data: Row[]; error: null; count: number }) => void) {
      const list = rows.filter(r => filters.every(f => f(r)));
      // Emulate PostgREST's embedded-resource join used by resolveBatch.
      const shaped = list.map(r => {
        if (name === "wa_batch_members" && cols.some(c => c.startsWith("wa_batches"))) {
          const b = table("wa_batches").find(x => x.id === r.batch_id);
          return { wa_batches: b ? { id: b.id, name: b.name, kind: b.kind, archived_at: b.archived_at ?? null } : null };
        }
        if (name === "wa_batch_members" && cols.some(c => c.startsWith("contacts"))) {
          const c = table("contacts").find(x => x.id === r.contact_id);
          return {
            contact_id: r.contact_id, added_at: r.added_at ?? null,
            contacts: c ? { id: c.id, phone: c.phone, name: c.name, status: c.status,
                            opted_in: c.opted_in === true, opt_in_at: c.opt_in_at ?? null } : null,
          };
        }
        return { ...r };
      });
      // count is the FULL matching size; data is only the requested page.
      const paged = rangeFrom >= 0 ? shaped.slice(rangeFrom, rangeTo + 1) : shaped;
      res({ data: paged as Row[], error: null, count: shaped.length });
    },
  };
  return q;
}

const fakeDb = {
  from(name: string) {
    const rows = table(name);
    return {
      ...makeQuery(name, rows),
      insert(payload: Row | Row[]) {
        writes.push({ table: name, op: "insert", payload });
        if (failInsertOn === name) return Promise.resolve({ data: null, error: { message: "insert blocked" } });
        const list = Array.isArray(payload) ? payload : [payload];
        const made: Row[] = list.map(o => ({ id: `${name}_${seq++}`, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", ...o }));
        // Rows insert with an explicit tenant; default it so a fixture that
        // omits it still behaves like the real column default.
        for (const m of made) if (m.tenant_id === undefined) m.tenant_id = T1;
        rows.push(...made);
        return { select: () => ({ single: async () => ({ data: made[0], error: null }), then: (r: (v: unknown) => void) => r({ data: made, error: null }) }), then: (r: (v: unknown) => void) => r({ data: made, error: null }) };
      },
      upsert(payload: Row | Row[], opts?: { ignoreDuplicates?: boolean }) {
        writes.push({ table: name, op: "upsert", payload });
        const list = Array.isArray(payload) ? payload : [payload];
        const fresh: Row[] = [];
        for (const o of list) {
          const dup = name === "wa_batch_members" && rows.some(r => r.batch_id === o.batch_id && r.contact_id === o.contact_id);
          if (dup && opts?.ignoreDuplicates) continue;
          const made = { id: `${name}_${seq++}`, tenant_id: T1, ...o };
          rows.push(made); fresh.push(made);
        }
        return { select: () => ({ then: (r: (v: unknown) => void) => r({ data: fresh, error: null }) }) };
      },
      update(patch: Row) {
        const filters: ((r: Row) => boolean)[] = [];
        const b = {
          eq(k: string, v: unknown) { filters.push(r => r[k] === v); return b; },
          in(k: string, vs: unknown[]) { filters.push(r => vs.includes(r[k])); return b; },
          select() {
            const hit = rows.filter(r => filters.every(f => f(r)));
            for (const r of hit) Object.assign(r, patch);
            writes.push({ table: name, op: "update", payload: patch });
            return { then: (res: (v: unknown) => void) => res({ data: hit.map(r => ({ ...r })), error: null }) };
          },
          then(res: (v: unknown) => void) {
            const hit = rows.filter(r => filters.every(f => f(r)));
            for (const r of hit) Object.assign(r, patch);
            writes.push({ table: name, op: "update", payload: patch });
            res({ data: hit, error: null });
          },
        };
        return b;
      },
      delete() {
        const filters: ((r: Row) => boolean)[] = [];
        const b = {
          eq(k: string, v: unknown) { filters.push(r => r[k] === v); return b; },
          in(k: string, vs: unknown[]) { filters.push(r => vs.includes(r[k])); return b; },
          then(res: (v: unknown) => void) {
            for (const r of rows.filter(x => filters.every(f => f(x)))) {
              const i = rows.indexOf(r); if (i >= 0) rows.splice(i, 1);
            }
            res({ error: null });
          },
        };
        return b;
      },
    };
  },
};

vi.mock("../supabase", () => ({ db: () => fakeDb }));

const {
  createBatch, addBatchMembers, addBatchMembersFromFilter, resolveBatch,
  batchSize, consentMissing, batchMembers, contactIdForPhone, batchesForContact, archiveBatch,
} = await import("../audience");

const T1 = "00000000-0000-0000-0000-000000000001";   // default tenant
const T2 = "00000000-0000-0000-0000-0000000000ff";   // a different workspace

function contact(id: string, phone: string, extra: Row = {}) {
  table("contacts").push({ id, phone, name: `C-${id}`, status: "active", tags: [], attributes: {},
                           source: "inbound", tenant_id: T1, opted_in: true, ...extra });
}

describe("batches", () => {
  beforeEach(() => {
    for (const k of Object.keys(tables)) tables[k].length = 0;
    writes.length = 0; failInsertOn = null; seq = 0;
  });

  it("resolves a static batch from its explicit membership", async () => {
    contact("c1", "919000000001"); contact("c2", "919000000002");
    const b = await createBatch({ name: "Weekend batch" });
    await addBatchMembers(b.id, ["c1", "c2"]);

    const r = await resolveBatch(b.id);
    expect(r.map(x => x.phone).sort()).toEqual(["919000000001", "919000000002"]);
    expect(await batchSize(b.id)).toBe(2);
  });

  it("drops a member whose contact is no longer active", async () => {
    // Membership outlives a contact being deactivated, so resolution — not the
    // member list — is what must not send to them.
    contact("c1", "919000000001");
    contact("c2", "919000000002", { status: "blocked" });
    const b = await createBatch({ name: "Static" });
    await addBatchMembers(b.id, ["c1", "c2"]);

    const r = await resolveBatch(b.id);
    expect(r.map(x => x.phone)).toEqual(["919000000001"]);
  });

  it("adding the same contact twice is a no-op, not an error", async () => {
    contact("c1", "919000000001");
    const b = await createBatch({ name: "Dedup" });
    expect(await addBatchMembers(b.id, ["c1"])).toBe(1);
    expect(await addBatchMembers(b.id, ["c1"])).toBe(0);
    expect(await batchSize(b.id)).toBe(1);
  });

  it("resolves a dynamic batch by re-running its filter", async () => {
    contact("c1", "919000000001", { tags: ["webinar"] });
    contact("c2", "919000000002", { tags: ["other"] });
    const b = await createBatch({ name: "Webinar", kind: "dynamic", filter: { tag: "webinar" } });

    expect((await resolveBatch(b.id)).map(x => x.phone)).toEqual(["919000000001"]);

    // A contact tagged AFTER the batch was made is included — that is the point
    // of a dynamic batch, and the reason its past membership isn't recoverable.
    contact("c3", "919000000003", { tags: ["webinar"] });
    expect((await resolveBatch(b.id)).length).toBe(2);
  });

  it("materialises a filter into static membership", async () => {
    contact("c1", "919000000001", { source: "web_chat" });
    contact("c2", "919000000002", { source: "inbound" });
    const b = await createBatch({ name: "From filter" });
    expect(await addBatchMembersFromFilter(b.id, { source: "web_chat" })).toBe(1);
    expect((await resolveBatch(b.id)).map(x => x.phone)).toEqual(["919000000001"]);
  });

  it("lists members with contact ids, so the detail view can remove them", async () => {
    contact("c1", "919000000001");
    contact("c2", "919000000002", { opted_in: false });
    const b = await createBatch({ name: "Detail" });
    await addBatchMembers(b.id, ["c1", "c2"]);

    const { members, total } = await batchMembers(b.id);
    expect(total).toBe(2);
    // resolveBatch returns only what a SEND needs (phone + name) — a UI built
    // on that could show members but never remove one.
    expect(members.map(m => m.id).sort()).toEqual(["c1", "c2"]);
    expect(members.find(m => m.id === "c1")?.optedIn).toBe(true);
    expect(members.find(m => m.id === "c2")?.optedIn).toBe(false);
  });

  it("pages members, reporting the full total alongside the page", async () => {
    for (let i = 1; i <= 5; i++) contact(`c${i}`, `91900000000${i}`);
    const b = await createBatch({ name: "Paged" });
    await addBatchMembers(b.id, ["c1", "c2", "c3", "c4", "c5"]);

    const first = await batchMembers(b.id, 0, 2);
    expect(first.members.length).toBe(2);
    expect(first.total).toBe(5);            // the WHOLE batch, not the page
    expect((await batchMembers(b.id, 4, 2)).members.length).toBe(1);
  });

  it("lists a dynamic batch's members from its filter", async () => {
    contact("c1", "919000000001", { tags: ["webinar"] });
    contact("c2", "919000000002", { tags: ["other"] });
    const b = await createBatch({ name: "Dyn", kind: "dynamic", filter: { tag: "webinar" } });
    const { members, total } = await batchMembers(b.id);
    expect(total).toBe(1);
    expect(members[0].id).toBe("c1");
    expect(members[0].addedAt).toBeNull();  // membership is implied, not recorded
  });

  it("returns nothing for a batch that doesn't exist", async () => {
    expect(await batchMembers("nope")).toEqual({ members: [], total: 0 });
  });

  it("resolves a lead's contact even when the country code is missing", async () => {
    // Live Chat keys on a conversation; batches key on contacts.id. The join is
    // the phone, and a lead who typed 10 digits must reach the stored
    // country-coded row rather than looking like someone else.
    contact("c1", "918368872108");
    expect(await contactIdForPhone("8368872108")).toBe("c1");
    expect(await contactIdForPhone("+91 83688 72108")).toBe("c1");
    expect(await contactIdForPhone("918368872108")).toBe("c1");
  });

  it("prefers the country-coded row when both forms exist", async () => {
    contact("short", "8368872108");
    contact("full", "918368872108");
    expect(await contactIdForPhone("8368872108")).toBe("full");
  });

  it("returns null for an unknown or too-short number", async () => {
    contact("c1", "918368872108");
    expect(await contactIdForPhone("919999999999")).toBeNull();
    expect(await contactIdForPhone("12345")).toBeNull();
    expect(await contactIdForPhone("")).toBeNull();
  });

  it("lists the static batches a lead belongs to", async () => {
    contact("c1", "918368872108");
    const a = await createBatch({ name: "Aug weekend" });
    const b = await createBatch({ name: "Dynamic one", kind: "dynamic", filter: { tag: "x" } });
    await addBatchMembers(a.id, ["c1"]);
    await addBatchMembers(b.id, ["c1"]);   // wouldn't happen via the API, but must not leak here

    const got = await batchesForContact("c1");
    // Dynamic batches are excluded: membership there is a filter result, so
    // "remove this person" is not something the UI can honestly offer.
    expect(got.map(x => x.name)).toEqual(["Aug weekend"]);
  });

  it("hides an archived batch from a lead's list", async () => {
    contact("c1", "918368872108");
    const a = await createBatch({ name: "Old batch" });
    await addBatchMembers(a.id, ["c1"]);
    expect((await batchesForContact("c1")).length).toBe(1);
    await archiveBatch(a.id);
    expect(await batchesForContact("c1")).toEqual([]);
  });

  it("keeps one workspace's batches out of another's list", async () => {
    contact("c1", "919000000001");
    const mine = await createBatch({ name: "Mine", tenantId: T1 });
    await addBatchMembers(mine.id, ["c1"], null, T1);
    // Same id, wrong tenant: every read is tenant-scoped, so a cross-workspace
    // guess must resolve to nothing rather than another tenant's audience.
    expect(await batchSize(mine.id, T2)).toBe(0);
    await expect(resolveBatch(mine.id, T2)).rejects.toThrow(/not found/i);
    expect(await batchesForContact("c1", T2)).toEqual([]);
  });

  it("reports who in a batch is not opted in", async () => {
    contact("c1", "919000000001");
    contact("c2", "919000000002", { opted_in: false });
    const missing = await consentMissing(["919000000001", "919000000002"]);
    expect(missing.has("9000000002")).toBe(true);
    expect(missing.has("9000000001")).toBe(false);
  });

  it("matches a TYPED number against the stored country-coded contact", async () => {
    // A pasted recipient "8368872108" compared exactly against contacts.phone
    // "918368872108" finds nothing and would be treated as not opted in, even
    // though that contact consented — so the whole send reaches nobody.
    contact("c1", "918368872108");
    expect((await consentMissing(["8368872108"])).size).toBe(0);
    expect((await consentMissing(["+91 83688 72108"])).size).toBe(0);
  });

  it("still reports a typed number whose contact has NOT opted in", async () => {
    // The tolerant match must not become a blanket pass.
    contact("c1", "918368872108", { opted_in: false });
    expect((await consentMissing(["8368872108"])).has("8368872108")).toBe(true);
  });

  it("counts a number that isn't a contact at all as not opted in", async () => {
    // A pasted or typed-in number has no record, and no record is not consent.
    expect((await consentMissing(["919999999999"])).has("9999999999")).toBe(true);
  });

  it("rejects a batch with no name", async () => {
    await expect(createBatch({ name: "   " })).rejects.toThrow(/name is required/i);
  });
});
