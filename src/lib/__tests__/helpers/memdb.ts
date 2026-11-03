// An in-memory stand-in for the Supabase client, for end-to-end tests that run
// the real code paths (routes → lib → tenantdb → "database") without a network.
// It implements the query-builder surface those paths use: select (with exact
// counts), insert, update, upsert, delete, the common filters, order, limit, range,
// maybeSingle/single, and unique constraints that answer 23505 like Postgres.

type Row = Record<string, unknown>;
type Pred = (r: Row) => boolean;

export interface MemDb {
  tables: Record<string, Row[]>;
  unique: Record<string, string[][]>;   // table → column sets that must be unique (null-skipping)
  client: { from: (t: string) => unknown; rpc: () => Promise<{ data: null; error: null }> };
}

let seq = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

export function memdb(unique: Record<string, string[][]> = {}): MemDb {
  const tables: Record<string, Row[]> = {};
  const rows = (t: string) => (tables[t] ??= []);
  const self: MemDb = { tables, unique, client: { from: (t: string) => q(t), rpc: async () => ({ data: null, error: null }) } };

  function q(table: string) {
    const preds: Pred[] = [];
    let op: "select" | "insert" | "update" | "upsert" | "delete" = "select";
    let payload: Row[] = [];
    let patch: Row = {};
    let head = false, count = false, single = false, orNull = false;
    let orderBy: { col: string; asc: boolean }[] = [];
    let lim: number | null = null, from = 0, to: number | null = null;
    let onConflict: string[] = [];
    let ignoreDup = false;
    const b: Record<string, unknown> = {};
    const chain = (fn: (...a: unknown[]) => void) => (...a: unknown[]) => { fn(...a); return b; };
    b.select = chain((_c, opts) => { const o = opts as { count?: string; head?: boolean } | undefined; if (o?.count) count = true; if (o?.head) head = true; });
    b.insert = chain(p => { op = "insert"; payload = (Array.isArray(p) ? p : [p]) as Row[]; });
    b.upsert = chain((p, o) => { op = "upsert"; payload = (Array.isArray(p) ? p : [p]) as Row[]; const oo = o as { onConflict?: string; ignoreDuplicates?: boolean } | undefined; onConflict = (oo?.onConflict ?? "id").split(","); ignoreDup = !!oo?.ignoreDuplicates; });
    b.update = chain(p => { op = "update"; patch = p as Row; });
    b.delete = chain(o => { op = "delete"; if ((o as { count?: string } | undefined)?.count) count = true; });
    b.eq = chain((c, v) => preds.push(r => r[c as string] === v));
    b.neq = chain((c, v) => preds.push(r => r[c as string] !== v));
    b.in = chain((c, v) => preds.push(r => (v as unknown[]).includes(r[c as string])));
    b.gte = chain((c, v) => preds.push(r => r[c as string] != null && String(r[c as string]) >= String(v)));
    b.gt = chain((c, v) => preds.push(r => r[c as string] != null && String(r[c as string]) > String(v)));
    b.lt = chain((c, v) => preds.push(r => r[c as string] != null && String(r[c as string]) < String(v)));
    b.lte = chain((c, v) => preds.push(r => r[c as string] != null && String(r[c as string]) <= String(v)));
    b.is = chain((c, v) => preds.push(r => (v === null ? r[c as string] == null : r[c as string] === v)));
    b.not = chain((c, o, v) => preds.push(r => (o === "is" && v === null ? r[c as string] != null : r[c as string] !== v)));
    b.like = chain((c, v) => { const re = new RegExp("^" + String(v).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*") + "$"); preds.push(r => re.test(String(r[c as string] ?? ""))); });
    const likeRe = (v: unknown, flags = "") => new RegExp("^" + String(v).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*") + "$", flags);
    b.ilike = chain((c, v) => { const re = likeRe(v, "i"); preds.push(r => re.test(String(r[c as string] ?? ""))); });
    // PostgREST or(): "col.op.value,col.op.value" with eq / ilike / like.
    b.or = chain(expr => {
      const parts = String(expr).split(",").map(p => { const [col, opName, ...rest] = p.split("."); return { col, opName, value: rest.join(".") }; });
      preds.push(r => parts.some(({ col, opName, value }) =>
        opName === "eq" ? String(r[col] ?? "") === value
          : opName === "ilike" ? likeRe(value, "i").test(String(r[col] ?? ""))
          : opName === "like" ? likeRe(value).test(String(r[col] ?? "")) : false));
    });
    b.order = chain((c, o) => orderBy.push({ col: c as string, asc: (o as { ascending?: boolean } | undefined)?.ascending !== false }));
    b.limit = chain(n => { lim = n as number; });
    b.range = chain((f, t) => { from = f as number; to = t as number; });
    b.maybeSingle = () => { single = true; orNull = true; return run(); };
    b.single = () => { single = true; return run(); };
    b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => run().then(res, rej);

    const match = () => rows(table).filter(r => preds.every(p => p(r)));
    const violates = (cand: Row, ignoreSelf?: Row) => (unique[table] ?? []).some(cols =>
      cols.every(c => cand[c] != null) && rows(table).some(r => r !== ignoreSelf && cols.every(c => r[c] === cand[c])));

    async function run(): Promise<{ data: unknown; error: { code?: string; message: string } | null; count?: number }> {
      if (op === "insert" || op === "upsert") {
        const out: Row[] = [];
        for (const p of payload) {
          const row: Row = { id: uuid(), created_at: new Date().toISOString(), ...p };
          if (op === "upsert") {
            const existing = rows(table).find(r => onConflict.every(c => r[c] === row[c]));
            if (existing) { if (!ignoreDup) Object.assign(existing, p); continue; }
          }
          if (violates(row)) return { data: null, error: { code: "23505", message: `duplicate key value violates unique constraint on ${table}` } };
          rows(table).push(row);
          out.push(row);
        }
        return { data: single ? out[0] ?? null : out, error: null };
      }
      if (op === "delete") {
        const hit = match();
        tables[table] = rows(table).filter(r => !hit.includes(r));
        return { data: hit, error: null, ...(count ? { count: hit.length } : {}) };
      }
      if (op === "update") {
        const hit = match();
        hit.forEach(r => Object.assign(r, patch));
        return { data: single ? hit[0] ?? null : hit, error: null };
      }
      let res = match();
      for (const o of [...orderBy].reverse()) res = [...res].sort((a, c) => (String(a[o.col] ?? "") < String(c[o.col] ?? "") ? -1 : String(a[o.col] ?? "") > String(c[o.col] ?? "") ? 1 : 0) * (o.asc ? 1 : -1));
      const total = res.length;
      res = res.slice(from, to === null ? undefined : to + 1);
      if (lim !== null) res = res.slice(0, lim);
      if (head) return { data: null, error: null, count: total };
      if (single) return orNull || res.length ? { data: res[0] ?? null, error: null } : { data: null, error: { message: "no rows" } };
      return { data: res, error: null, ...(count ? { count: total } : {}) };
    }
    return b;
  }
  return self;
}
