// Team members + activity log. The env ADMIN_USER stays the owner account;
// wa_users rows are additional members with their own passwords and roles.
// Everything degrades gracefully when migration 0014 isn't applied.

import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { db } from "./supabase";

export interface TeamUser {
  id: string;
  email: string;
  name: string;
  title: string;             // role/persona label, e.g. "Sales Counsellor"
  role: "admin" | "member";
  tenantId: string;
  active: boolean;
  tokenVersion: number;
  lastLoginAt: string | null;
  createdAt: string;
}

const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000001";

function mapUser(r: Record<string, unknown>): TeamUser {
  return {
    id: r.id as string,
    email: r.email as string,
    name: (r.name as string) ?? "",
    title: (r.title as string) ?? "",
    role: (r.role as TeamUser["role"]) ?? "member",
    tenantId: (r.tenant_id as string) ?? DEFAULT_TENANT_ID,
    active: (r.active as boolean) ?? true,
    tokenVersion: (r.token_version as number) ?? 0,
    lastLoginAt: (r.last_login_at as string | null) ?? null,
    createdAt: r.created_at as string,
  };
}

// Live auth state for a member, read on every request by verifySession so that
// deactivation and role changes take effect immediately (not at token expiry).
// Returns null when the user is gone/inactive or the table is missing.
export interface MemberAuthState { role: "admin" | "member"; tokenVersion: number }
export async function getMemberAuthState(email: string): Promise<MemberAuthState | null> {
  try {
    const { data } = await db().from("wa_users")
      .select("role, active, token_version")
      .eq("email", email.trim().toLowerCase()).maybeSingle();
    if (!data || !(data.active as boolean)) return null;
    return { role: (data.role as "admin" | "member") ?? "member", tokenVersion: (data.token_version as number) ?? 0 };
  } catch {
    return null;   // table missing → pre-team mode; caller treats as no member
  }
}

// ── Passwords (scrypt, no external deps) ──────────────────────────────────────
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

// ── CRUD (tenant-scoped) ──────────────────────────────────────────────────────
export async function listUsers(tenantId = DEFAULT_TENANT_ID): Promise<TeamUser[]> {
  try {
    const { data, error } = await db().from("wa_users").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: true });
    if (error) throw error;
    return (data ?? []).map(mapUser);
  } catch { return []; }     // table missing → owner-only mode
}

export async function saveUser(input: { id?: string; email: string; name: string; title?: string; role: "admin" | "member"; password?: string; active?: boolean }, tenantId = DEFAULT_TENANT_ID): Promise<TeamUser> {
  const row: Record<string, unknown> = {
    email: input.email.trim().toLowerCase(),
    name: input.name.trim(),
    title: (input.title ?? "").trim(),
    role: input.role,
    active: input.active ?? true,
    tenant_id: tenantId,
  };
  if (input.password?.trim()) row.password_hash = hashPassword(input.password.trim());
  if (!input.id && !row.password_hash) throw new Error("Password is required for a new member");
  const run = (r: Record<string, unknown>) => input.id
    ? db().from("wa_users").update(r).eq("id", input.id).eq("tenant_id", tenantId).select().single()
    : db().from("wa_users").insert(r).select().single();
  let { data, error } = await run(row);
  if (error && /title/i.test(error.message)) {
    // Pre-0015 schema (no title column) — save the rest so nothing blocks.
    delete row.title;
    ({ data, error } = await run(row));
  }
  if (error) throw error;
  const saved = mapUser(data as Record<string, unknown>);
  // Changing the password invalidates existing sessions (log out everywhere).
  if (input.id && input.password?.trim()) {
    try {
      await db().from("wa_users").update({ token_version: saved.tokenVersion + 1 }).eq("id", input.id).eq("tenant_id", tenantId);
      saved.tokenVersion += 1;
    } catch { /* token_version column missing (pre-0038) — ignore */ }
  }
  return saved;
}

export async function deleteUser(id: string, tenantId = DEFAULT_TENANT_ID): Promise<void> {
  const { error } = await db().from("wa_users").delete().eq("id", id).eq("tenant_id", tenantId);
  if (error) throw error;
}

// Login check against wa_users (the env admin is handled separately).
export async function verifyTeamLogin(email: string, password: string): Promise<TeamUser | null> {
  try {
    const { data } = await db().from("wa_users").select("*").eq("email", email.trim().toLowerCase()).maybeSingle();
    if (!data || !(data.active as boolean)) return null;
    if (!verifyPassword(password, data.password_hash as string)) return null;
    await db().from("wa_users").update({ last_login_at: new Date().toISOString() }).eq("id", data.id);
    return mapUser(data as Record<string, unknown>);
  } catch { return null; }
}

// ── Activity log ──────────────────────────────────────────────────────────────
export interface ActivityEntry { id: string; userEmail: string; userName: string; action: string; detail: string; at: string }

// Fire-and-forget — audit logging must never break the action being logged.
// actor carries tenantId (SessionUser/TeamUser both have it) so the log row is
// auto-stamped with the tenant without touching the ~30 call sites.
export function logActivity(actor: { email: string; name?: string; tenantId?: string } | null, action: string, detail = ""): void {
  if (!actor?.email) return;
  void db().from("wa_activity_log").insert({
    tenant_id: actor.tenantId ?? DEFAULT_TENANT_ID,
    user_email: actor.email,
    user_name: actor.name ?? "",
    action,
    detail: detail.slice(0, 500),
  }).then(() => undefined, () => undefined);
}

export async function listActivity(limit = 200, tenantId = DEFAULT_TENANT_ID): Promise<ActivityEntry[]> {
  try {
    const { data, error } = await db().from("wa_activity_log").select("*").eq("tenant_id", tenantId).order("at", { ascending: false }).limit(Math.min(500, limit));
    if (error) throw error;
    return (data ?? []).map(r => ({
      id: r.id as string,
      userEmail: r.user_email as string,
      userName: (r.user_name as string) ?? "",
      action: r.action as string,
      detail: (r.detail as string) ?? "",
      at: r.at as string,
    }));
  } catch { return []; }
}
