// The cross-business read behind the owner's Security screen: one level per
// account (securitylevels.ts), people counted, never listed.

import { db } from "./supabase";
import { DEFAULT_TENANT_ID } from "./tenant";
import { accountSecurity, LEVEL_ORDER, type AccountSecurity, type PersonSecurity, type SecurityLevel } from "./securitylevels";

export interface AccountSecurityRow extends AccountSecurity {
  tenantId: string;
  name: string;
  slug: string;
  status: string;
}

export interface SecurityReport {
  /** False when a security table can't be read: then nothing is claimed about anyone. */
  available: boolean;
  problem: string | null;
  counts: Record<SecurityLevel, number>;
  accounts: AccountSecurityRow[];
}

// PostgREST returns at most 1,000 rows per request whatever .limit() says, so
// a single select would quietly drop everyone past the thousandth person and
// report their business on whoever was left. Read in pages, in a stable order.
const PAGE = 1000;
async function readAll(table: string, columns: string, orderBy: string): Promise<{ data: Record<string, unknown>[]; error: { message: string } | null }> {
  const out: Record<string, unknown>[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db().from(table).select(columns).order(orderBy).range(from, from + PAGE - 1);
    if (error) return { data: [], error };
    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    out.push(...rows);
    if (rows.length < PAGE) return { data: out, error: null };
  }
}

/**
 * Every account's level. Cross-business by design, so only an owner-gated
 * route may call it. Reads with errors CHECKED: a missing table must read as
 * "can't tell", never as every business high-risk, or all of them empty.
 */
export async function securityReport(): Promise<SecurityReport> {
  const [tenants, users, twoFa, passkeys] = await Promise.all([
    readAll("tenants", "id, name, slug, status", "id"),
    readAll("wa_users", "email, role, active, tenant_id", "email"),
    readAll("wa_user_2fa", "email, confirmed_at", "email"),
    readAll("wa_user_passkeys", "email, credential_id", "credential_id"),
  ]);
  const counts: Record<SecurityLevel, number> = { high: 0, partial: 0, good: 0, secure: 0, empty: 0 };
  const missing = [
    tenants.error && "the tenant register",
    users.error && "the team (wa_users)",
    twoFa.error && "authenticator apps (0117)",
    passkeys.error && "passkeys (0117)",
  ].filter(Boolean);
  if (missing.length) return { available: false, problem: `Couldn't read ${missing.join(", ")}. Nothing is shown rather than a guess.`, counts, accounts: [] };

  const lower = (s: unknown) => String(s ?? "").trim().toLowerCase();
  const enrolled = new Set(twoFa.data.filter(r => r.confirmed_at).map(r => lower(r.email)));
  const pk = new Map<string, number>();
  for (const r of passkeys.data) pk.set(lower(r.email), (pk.get(lower(r.email)) ?? 0) + 1);
  const person = (email: string, role: string): PersonSecurity => ({
    role, twoFactor: enrolled.has(email), passkeys: pk.get(email) ?? 0, recoveryVerified: false,
  });

  const byTenant = new Map<string, PersonSecurity[]>();
  for (const u of users.data) {
    if (u.active === false) continue;   // a deactivated person can't sign in
    const t = (u.tenant_id as string | null) ?? DEFAULT_TENANT_ID;
    byTenant.set(t, [...(byTenant.get(t) ?? []), person(lower(u.email), String(u.role ?? "member"))]);
  }
  // The platform owner is the env ADMIN_USER account with no wa_users row; they
  // sign in to the default workspace as its admin.
  const owner = lower(process.env.ADMIN_USER);
  if (owner && !users.data.some(u => lower(u.email) === owner)) {
    byTenant.set(DEFAULT_TENANT_ID, [...(byTenant.get(DEFAULT_TENANT_ID) ?? []), person(owner, "admin")]);
  }

  const accounts = tenants.data.map(t => ({
    tenantId: String(t.id), name: String(t.name ?? ""), slug: String(t.slug ?? ""), status: String(t.status ?? ""),
    ...accountSecurity(byTenant.get(String(t.id)) ?? []),
  }));
  for (const a of accounts) counts[a.level]++;
  accounts.sort((a, b) => LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level) || a.name.localeCompare(b.name));
  return { available: true, problem: null, counts, accounts };
}
