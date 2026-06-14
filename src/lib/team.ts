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
  active: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

function mapUser(r: Record<string, unknown>): TeamUser {
  return {
    id: r.id as string,
    email: r.email as string,
    name: (r.name as string) ?? "",
    title: (r.title as string) ?? "",
    role: (r.role as TeamUser["role"]) ?? "member",
    active: (r.active as boolean) ?? true,
    lastLoginAt: (r.last_login_at as string | null) ?? null,
    createdAt: r.created_at as string,
  };
}

// ── Passwords (scrypt, no external deps) ──────────────────────────────────────
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

// ── CRUD ──────────────────────────────────────────────────────────────────────
export async function listUsers(): Promise<TeamUser[]> {
  try {
    const { data, error } = await db().from("wa_users").select("*").order("created_at", { ascending: true });
    if (error) throw error;
    return (data ?? []).map(mapUser);
  } catch { return []; }     // table missing → owner-only mode
}

export async function saveUser(input: { id?: string; email: string; name: string; title?: string; role: "admin" | "member"; password?: string; active?: boolean }): Promise<TeamUser> {
  const row: Record<string, unknown> = {
    email: input.email.trim().toLowerCase(),
    name: input.name.trim(),
    title: (input.title ?? "").trim(),
    role: input.role,
    active: input.active ?? true,
  };
  if (input.password?.trim()) row.password_hash = hashPassword(input.password.trim());
  if (!input.id && !row.password_hash) throw new Error("Password is required for a new member");
  const run = (r: Record<string, unknown>) => input.id
    ? db().from("wa_users").update(r).eq("id", input.id).select().single()
    : db().from("wa_users").insert(r).select().single();
  let { data, error } = await run(row);
  if (error && /title/i.test(error.message)) {
    // Pre-0015 schema (no title column) — save the rest so nothing blocks.
    delete row.title;
    ({ data, error } = await run(row));
  }
  if (error) throw error;
  return mapUser(data as Record<string, unknown>);
}

export async function deleteUser(id: string): Promise<void> {
  const { error } = await db().from("wa_users").delete().eq("id", id);
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
export function logActivity(actor: { email: string; name?: string } | null, action: string, detail = ""): void {
  if (!actor?.email) return;
  void db().from("wa_activity_log").insert({
    user_email: actor.email,
    user_name: actor.name ?? "",
    action,
    detail: detail.slice(0, 500),
  }).then(() => undefined, () => undefined);
}

export async function listActivity(limit = 200): Promise<ActivityEntry[]> {
  try {
    const { data, error } = await db().from("wa_activity_log").select("*").order("at", { ascending: false }).limit(Math.min(500, limit));
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
