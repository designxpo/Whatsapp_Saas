import { DEFAULT_TENANT_ID } from "./tenant";
// Team members + activity log. The env ADMIN_USER stays the owner account;
// wa_users rows are additional members with their own passwords and roles.
// Everything degrades gracefully when migration 0014 isn't applied.

import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { db } from "./supabase";
import { asTeam, asRole, type Team, type Role } from "./teams";

export interface TeamUser {
  id: string;
  email: string;
  name: string;
  title: string;             // role/persona label, e.g. "Sales Counsellor"
  role: Role;
  /** Pinned team, or null = unrestricted (the default — nothing changes until one is set). */
  team: Team | null;
  /** The number this member personally works, or null. */
  channelId: string | null;
  tenantId: string;
  active: boolean;
  tokenVersion: number;
  lastLoginAt: string | null;
  createdAt: string;
}


function mapUser(r: Record<string, unknown>): TeamUser {
  return {
    id: r.id as string,
    email: r.email as string,
    name: (r.name as string) ?? "",
    title: (r.title as string) ?? "",
    role: asRole(r.role),
    team: asTeam(r.team),
    channelId: (r.channel_id as string | null) ?? null,
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
export interface MemberAuthState { role: Role; team: Team | null; tokenVersion: number }
export async function getMemberAuthState(email: string): Promise<MemberAuthState | null> {
  try {
    // `team` arrived later than the rest: a workspace that has not applied the
    // team migration must still sign in, so a missing column degrades to
    // "no team" rather than "no member".
    let { data, error } = await db().from("wa_users")
      .select("role, active, token_version, team")
      .eq("email", email.trim().toLowerCase()).maybeSingle();
    if (error && (error.code === "42703" || error.code === "PGRST204")) {
      ({ data, error } = await db().from("wa_users")
        .select("role, active, token_version")
        .eq("email", email.trim().toLowerCase()).maybeSingle());
    }
    if (!data || !(data.active as boolean)) return null;
    return { role: asRole(data.role), team: asTeam((data as Record<string, unknown>).team), tokenVersion: (data.token_version as number) ?? 0 };
  } catch {
    return null;   // table missing → pre-team mode; caller treats as no member
  }
}

// Everything a session needs about a member, without a password — for sign-in
// paths that prove identity some other way (a passkey), where the tenant cannot
// come off an existing JWT because there isn't one yet.
export interface MemberIdentity { name: string; role: Role; team: Team | null; tenantId: string; tokenVersion: number }
export async function getMemberIdentity(email: string): Promise<MemberIdentity | null> {
  try {
    let { data, error } = await db().from("wa_users")
      .select("name, role, active, tenant_id, token_version, team")
      .eq("email", email.trim().toLowerCase()).maybeSingle();
    if (error && (error.code === "42703" || error.code === "PGRST204")) {
      ({ data, error } = await db().from("wa_users")
        .select("name, role, active, tenant_id, token_version")
        .eq("email", email.trim().toLowerCase()).maybeSingle());
    }
    if (!data || !(data.active as boolean)) return null;
    return {
      name: (data.name as string) || email,
      role: asRole(data.role),
      team: asTeam((data as Record<string, unknown>).team),
      tenantId: (data.tenant_id as string) ?? DEFAULT_TENANT_ID,
      tokenVersion: (data.token_version as number) ?? 0,
    };
  } catch {
    return null;
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

export async function saveUser(input: { id?: string; email: string; name: string; title?: string; role: Role; team?: Team | null; channelId?: string | null; password?: string; active?: boolean }, tenantId = DEFAULT_TENANT_ID): Promise<TeamUser> {
  const role = asRole(input.role);
  const row: Record<string, unknown> = {
    email: input.email.trim().toLowerCase(),
    name: input.name.trim(),
    title: (input.title ?? "").trim(),
    role,
    active: input.active ?? true,
    tenant_id: tenantId,
  };
  // team / channel_id are written ONLY when the caller supplies them. A self-edit
  // (the profile route) saves the member's own row back without naming either,
  // and must not silently wipe the team that scopes their inbox.
  if (input.team !== undefined) row.team = asTeam(input.team);
  if (input.channelId !== undefined) row.channel_id = input.channelId || null;
  // A lead with no team would come back UNRESTRICTED — the one combination that
  // must not exist. The database refuses it too; this says so in words.
  if (role === "lead" && input.team !== undefined && !asTeam(input.team)) {
    throw new Error("A team lead has to be assigned to a team");
  }
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
  if (error && (error.code === "42703" || error.code === "PGRST204") && ("team" in row || "channel_id" in row)) {
    // The team migration has not been applied. Everything else must still save;
    // but refuse to PRETEND a team or a lead role was stored when it was not.
    if (role === "lead" || row.team) throw new Error("Teams need the 20261019000000_port_wab_parity.sql migration — apply it, then save again");
    delete row.team; delete row.channel_id;
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
