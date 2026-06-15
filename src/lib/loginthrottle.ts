// DB-backed login brute-force throttle. Serverless-safe (no in-process state).
// Degrades OPEN if the wa_login_attempts table is missing (migration 0035 not
// applied) so a missing migration never bricks login — but once applied it
// locks a key after MAX_FAILS failures within WINDOW_MIN.

import { db } from "./supabase";

const MAX_FAILS = 5;
const WINDOW_MIN = 15;   // count failures within this window
const LOCK_MIN = 15;     // lock duration once the threshold is hit

// Stable throttle key from the request: client IP + the attempted username, so
// one IP guessing many users, or many IPs guessing one user, both get limited.
export function loginKey(req: Request, username: string): string {
  const xff = req.headers.get("x-forwarded-for") ?? "";
  const ip = xff.split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
  return `${ip}:${username.toLowerCase()}`.slice(0, 200);
}

export async function loginThrottle(key: string): Promise<{ allowed: boolean; retryAfterSec?: number }> {
  try {
    const since = new Date(Date.now() - WINDOW_MIN * 60_000).toISOString();
    const { data, error } = await db()
      .from("wa_login_attempts")
      .select("created_at")
      .eq("key", key)
      .gte("created_at", since)
      .order("created_at", { ascending: false });
    if (error) return { allowed: true };          // table missing → degrade open
    const fails = data?.length ?? 0;
    if (fails >= MAX_FAILS) {
      const newest = new Date(data![0].created_at as string).getTime();
      const retryAfterSec = Math.max(1, Math.ceil((newest + LOCK_MIN * 60_000 - Date.now()) / 1000));
      return { allowed: false, retryAfterSec };
    }
    return { allowed: true };
  } catch {
    return { allowed: true };
  }
}

export async function recordLoginFailure(key: string): Promise<void> {
  try { await db().from("wa_login_attempts").insert({ key }); } catch { /* best-effort */ }
}

export async function clearLoginFailures(key: string): Promise<void> {
  try { await db().from("wa_login_attempts").delete().eq("key", key); } catch { /* best-effort */ }
}
