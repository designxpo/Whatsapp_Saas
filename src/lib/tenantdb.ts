import type { SupabaseClient } from "@supabase/supabase-js";
import { db } from "./supabase";

// Tenant-scoped data access — the PRIMARY isolation guard.
//
// The service-role client bypasses Postgres RLS, so isolation cannot rely on
// the DB alone. `tdb(tenantId)` wraps the raw client so every read/write is
// automatically constrained to one tenant:
//
//   const t = tdb(tenantId);
//   await t.from("contacts").select("*").eq("phone", p);      // + tenant_id filter
//   await t.from("contacts").insert({ phone, name });          // + tenant_id stamped
//
// select / update / delete return the real Supabase builder (already filtered),
// so you can keep chaining .eq/.order/.single/etc. For queries the wrapper
// can't express (rpc, joins, .or across tables), use `t.raw` and scope by hand.

function stamp<T extends Record<string, unknown>>(rows: T | T[], tenantId: string): T | T[] {
  if (Array.isArray(rows)) return rows.map((r) => ({ ...r, tenant_id: tenantId }));
  return { ...rows, tenant_id: tenantId };
}

// Return type is inferred from the implementation — declaring it explicitly
// triggers TS2589 ("excessively deep") against Supabase's generics.
export function tdb(tenantId: string) {
  if (!tenantId) throw new Error("tdb() requires a tenantId");
  const c: SupabaseClient = db();
  return {
    tenantId,
    raw: c, // escape hatch — caller MUST scope by tenant_id manually
    from(table: string) {
      return {
        select: (columns = "*", opts?: { count?: "exact" | "planned" | "estimated"; head?: boolean }) =>
          c.from(table).select(columns, opts).eq("tenant_id", tenantId),
        insert: (rows: Record<string, unknown> | Record<string, unknown>[]) =>
          c.from(table).insert(stamp(rows, tenantId)),
        upsert: (rows: Record<string, unknown> | Record<string, unknown>[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }) =>
          c.from(table).upsert(stamp(rows, tenantId), opts),
        update: (values: Record<string, unknown>) =>
          c.from(table).update(values).eq("tenant_id", tenantId),
        delete: () => c.from(table).delete().eq("tenant_id", tenantId),
      };
    },
  };
}

export type TenantDb = ReturnType<typeof tdb>;
