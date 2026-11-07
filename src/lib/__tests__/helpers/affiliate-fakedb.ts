// In-memory stand-in for the Supabase client, just enough for the affiliate
// payout flows. The three SQL functions are re-implemented in JS from
// supabase/migrations/20261107120000_affiliate_payouts.sql; the SQL itself was
// exercised separately against a throwaway local Postgres, this lets the
// TypeScript around it be tested without one.
import { randomUUID } from "crypto";

type Row = Record<string, unknown>;
export interface Fake {
  tables: Record<string, Row[]>;
  selects: Array<{ table: string; cols: string }>;
  client: { from: (t: string) => unknown; rpc: (fn: string, args: Row) => Promise<{ data: unknown; error: unknown }> };
}

export function makeFakeDb(): Fake {
  const tables: Record<string, Row[]> = { wa_affiliates: [], wa_affiliate_commissions: [], wa_affiliate_payouts: [], tenants: [] };
  const selects: Fake["selects"] = [];
  const DAY = 86400000;

  function unique(table: string, row: Row, ignore?: Row): boolean {
    const rows = tables[table].filter(r => r !== ignore);
    if (table === "wa_affiliate_commissions") {
      if (row.kind === "earning" && row.provider_payment_id && rows.some(r => r.kind === "earning" && r.provider_payment_id === row.provider_payment_id)) return false;
      if (row.kind === "clawback" && row.ref_commission_id && rows.some(r => r.kind === "clawback" && r.ref_commission_id === row.ref_commission_id)) return false;
    }
    if (table === "wa_affiliate_payouts" && row.rzp_payout_id && rows.some(r => r.rzp_payout_id === row.rzp_payout_id)) return false;
    return true;
  }

  function builder(table: string) {
    let op: "select" | "insert" | "update" | "delete" = "select";
    let patch: Row = {}, inserted: Row[] = [];
    const filters: Array<(r: Row) => boolean> = [];
    let lim = Infinity, orderBy: { col: string; asc: boolean } | null = null;
    let returning = false, insertError: unknown = null;
    const matches = () => tables[table].filter(r => filters.every(f => f(r)));
    const run = (): { data: Row[] | null; error: unknown } => {
      if (op === "insert") return { data: insertError ? null : inserted, error: insertError };
      let rows = matches();
      if (op === "update") {
        for (const r of rows) {
          const next = { ...r, ...patch };
          if (patch.status === "pending" && false) void next;
          Object.assign(r, patch);
        }
        return { data: rows, error: null };
      }
      if (op === "delete") { tables[table] = tables[table].filter(r => !rows.includes(r)); return { data: rows, error: null }; }
      if (orderBy) { const { col, asc } = orderBy; rows = [...rows].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (asc ? 1 : -1)); }
      return { data: rows.slice(0, lim), error: null };
    };
    const b: Record<string, unknown> = {
      select: (cols = "*") => { if (op === "select") selects.push({ table, cols }); returning = true; return b; },
      insert: (v: Row | Row[]) => {
        op = "insert";
        for (const raw of Array.isArray(v) ? v : [v]) {
          const row: Row = { id: randomUUID(), created_at: new Date().toISOString(), ...(table === "wa_affiliate_commissions" ? { status: "pending", kind: "earning", flagged: false, payout_id: null } : {}), ...raw };
          if (!unique(table, row)) { insertError = { code: "23505", message: "duplicate key" }; return b; }
          tables[table].push(row); inserted.push(row);
        }
        return b;
      },
      update: (v: Row) => { op = "update"; patch = v; return b; },
      delete: () => { op = "delete"; return b; },
      eq: (c: string, v: unknown) => { filters.push(r => r[c] === v); return b; },
      in: (c: string, v: unknown[]) => { filters.push(r => v.includes(r[c])); return b; },
      is: (c: string, v: unknown) => { filters.push(r => (r[c] ?? null) === v); return b; },
      gte: (c: string, v: string) => { filters.push(r => r[c] != null && String(r[c]) >= v); return b; },
      lte: (c: string, v: string) => { filters.push(r => r[c] != null && String(r[c]) <= v); return b; },
      order: (col: string, o?: { ascending?: boolean }) => { orderBy = { col, asc: o?.ascending !== false }; return b; },
      limit: (n: number) => { lim = n; return b; },
      maybeSingle: () => { const r = run(); return Promise.resolve({ data: r.data?.[0] ?? null, error: r.error }); },
      single: () => { const r = run(); return Promise.resolve({ data: r.data?.[0] ?? null, error: r.error }); },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => { void returning; return Promise.resolve(run()).then(res, rej); },
    };
    return b;
  }

  async function rpc(fn: string, a: Row): Promise<{ data: unknown; error: unknown }> {
    const now = Date.now();
    const C = tables.wa_affiliate_commissions, P = tables.wa_affiliate_payouts;
    if (fn === "claim_affiliate_payout") {
      const af = tables.wa_affiliates.find(r => r.id === a.p_affiliate);
      if (!af || af.status !== "active" || af.risk_hold) return { data: null, error: null };
      if (!af.payout_kind || !af.rzpx_fund_account_id || !af.payout_verified_at || !af.payout_changed_at) return { data: null, error: null };
      if (Date.parse(af.payout_verified_at as string) < Date.parse(af.payout_changed_at as string)) return { data: null, error: null };
      if (Date.parse(af.payout_changed_at as string) > now - 7 * DAY) return { data: null, error: null };
      if (P.some(p => p.affiliate_id === a.p_affiliate && ["awaiting_approval", "approved", "processing"].includes(p.status as string))) return { data: null, error: null };
      const holdDays = Number(String(a.p_hold).split(" ")[0]);
      const payAt = (r: Row) => (r.payable_at ? Date.parse(r.payable_at as string) : Date.parse(r.created_at as string) + holdDays * DAY);
      const cands = C.filter(r => r.affiliate_id === a.p_affiliate && r.status === "pending" && r.kind === "earning" && !r.flagged && !r.payout_id && Number(r.commission_cents) > 0 && payAt(r) <= now)
        .sort((x, y) => payAt(x) - payAt(y));
      let run = 0; const earn: Row[] = [];
      for (const r of cands) { run += Number(r.commission_cents); if (run <= Number(a.p_max_cents)) earn.push(r); }
      if (!earn.length) return { data: null, error: null };
      const claw = C.filter(r => r.affiliate_id === a.p_affiliate && r.status === "pending" && r.kind === "clawback" && !r.payout_id);
      const net = earn.reduce((s, r) => s + Number(r.commission_cents), 0) + claw.reduce((s, r) => s + Number(r.commission_cents), 0);
      if (net < Number(a.p_min_cents) || net <= 0 || net > Number(a.p_max_cents)) return { data: null, error: null };
      const id = randomUUID();
      P.push({ id, affiliate_id: a.p_affiliate, amount_cents: net, status: "awaiting_approval", idempotency_key: id, rzp_payout_id: null, approved_at: null, created_at: new Date().toISOString(),
        payout_snapshot: { kind: af.payout_kind, last4: af.payout_last4, name: af.payout_name, fund_account_id: af.rzpx_fund_account_id } });
      for (const r of [...earn, ...claw]) { r.status = "processing"; r.payout_id = id; }
      return { data: id, error: null };
    }
    if (fn === "release_affiliate_payout") {
      const p = P.find(r => r.id === a.p_payout);
      if (!p) return { data: false, error: null };
      if (a.p_from && !(a.p_from as string[]).includes(p.status as string)) return { data: false, error: null };
      if (["failed", "cancelled", "reversed"].includes(p.status as string)) return { data: false, error: null };
      if (p.status === "paid" && a.p_status !== "reversed") return { data: false, error: null };
      p.status = a.p_status; p.failure_reason = a.p_reason;
      for (const r of C.filter(r => r.payout_id === a.p_payout && ["processing", "paid"].includes(r.status as string))) { r.status = "pending"; r.payout_id = null; r.paid_at = null; }
      return { data: true, error: null };
    }
    if (fn === "mark_affiliate_payout_paid") {
      const p = P.find(r => r.id === a.p_payout);
      if (!p || !["approved", "processing"].includes(p.status as string)) return { data: false, error: null };
      p.status = "paid"; p.utr = a.p_utr;
      for (const r of C.filter(r => r.payout_id === a.p_payout && r.status === "processing")) { r.status = "paid"; r.paid_at = new Date().toISOString(); }
      return { data: true, error: null };
    }
    return { data: null, error: { message: `unknown rpc ${fn}` } };
  }

  return { tables, selects, client: { from: builder, rpc } };
}
