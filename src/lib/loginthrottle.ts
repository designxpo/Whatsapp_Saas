// DB-backed login brute-force throttle. Serverless-safe (no in-process state).
// Degrades OPEN if the wa_login_attempts table is missing (migration 0035 not
// applied) so a missing migration never bricks login — but once applied it
// locks a key after too many failures within a window.
//
// Two keys guard every password sign-in:
//
//   • loginKey()   — client IP + the attempted username. Catches one address
//                    hammering one account (or walking a list of accounts).
//                    5 failures in 15 minutes locks that pair for 15 minutes.
//
//   • accountKey() — the attempted username alone. The IP comes from
//                    X-Forwarded-For, which a caller sets freely, so the first
//                    key on its own does NOT stop many addresses guessing one
//                    account. This one does: 20 failures in an hour locks the
//                    account for 30 minutes, whichever addresses they came from.
//
// The account lock is deliberately higher and always expires. It is keyed on a
// name anyone can type, so a stranger can trip it; a lower threshold or a
// permanent lock would let them keep a real person out of their own account at
// will. While it is locked, attempts are refused WITHOUT being counted, so the
// lock lifts 30 minutes after the last counted failure — keeping somebody out
// takes a sustained effort, not one burst.

import { db } from "./supabase";

export interface ThrottleLimits {
  maxFails: number;   // failures within the window that trigger a lock
  windowMin: number;  // count failures within this window
  lockMin: number;    // lock duration, from the most recent failure
}

/** Per IP + username (and every account-keyed code check that reuses it). */
export const KEY_LIMITS: ThrottleLimits = { maxFails: 5, windowMin: 15, lockMin: 15 };
/** Per username across every address. Higher, so it is hard to aim at someone. */
export const ACCOUNT_LIMITS: ThrottleLimits = { maxFails: 20, windowMin: 60, lockMin: 30 };

export interface ThrottleVerdict { allowed: boolean; retryAfterSec?: number }

// Stable throttle key from the request: client IP + the attempted username.
// Limits one IP guessing one (or many) users. Many IPs guessing one user is
// what accountKey() is for — check both.
//
// The address is cut down to the characters an IPv4/IPv6 address can contain.
// It comes from a header the caller writes, and unfiltered, "X-Forwarded-For:
// acct" would make this key identical to accountKey() — every failure would
// then count twice against the account-wide lock.
export function loginKey(req: Request, username: string): string {
  const xff = req.headers.get("x-forwarded-for") ?? "";
  const raw = xff.split(",")[0].trim() || req.headers.get("x-real-ip") || "";
  const ip = raw.replace(/[^0-9a-fA-F.:]/g, "").slice(0, 60) || "unknown";
  return `${ip}:${username.trim().toLowerCase()}`.slice(0, 200);
}

/** Account-wide throttle key: the attempted username, with no address in it. */
export function accountKey(username: string): string {
  return `acct:${username.trim().toLowerCase()}`.slice(0, 200);
}

/**
 * Pure lock decision over the failure timestamps (ms) recorded for one key.
 * Locked when at least `maxFails` fall inside the window AND the lock that the
 * newest one started has not yet run out.
 */
export function lockState(failTimesMs: number[], nowMs: number, limits: ThrottleLimits): ThrottleVerdict {
  const since = nowMs - limits.windowMin * 60_000;
  const recent = failTimesMs.filter(t => Number.isFinite(t) && t >= since);
  if (recent.length < limits.maxFails) return { allowed: true };
  const unlockAt = Math.max(...recent) + limits.lockMin * 60_000;
  if (unlockAt <= nowMs) return { allowed: true };
  return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((unlockAt - nowMs) / 1000)) };
}

/** Plain-English refusal, telling the person roughly how long to wait. */
export function lockedMessage(retryAfterSec?: number): string {
  const mins = Math.max(1, Math.ceil((retryAfterSec ?? 15 * 60) / 60));
  return `Too many failed sign-in attempts. Please wait about ${mins} minute${mins === 1 ? "" : "s"} and try again.`;
}

export async function loginThrottle(key: string, limits: ThrottleLimits = KEY_LIMITS): Promise<ThrottleVerdict> {
  try {
    const since = new Date(Date.now() - limits.windowMin * 60_000).toISOString();
    const { data, error } = await db()
      .from("wa_login_attempts")
      .select("created_at")
      .eq("key", key)
      .gte("created_at", since)
      .order("created_at", { ascending: false });
    if (error) return { allowed: true };          // table missing → degrade open
    const times = (data ?? []).map(r => new Date(r.created_at as string).getTime());
    return lockState(times, Date.now(), limits);
  } catch {
    return { allowed: true };
  }
}

/**
 * The per-IP key and the account-wide key together. Refused if EITHER is
 * locked, with the longer of the two waits.
 */
export async function loginThrottleBoth(ipKey: string, acctKey: string): Promise<ThrottleVerdict> {
  const [a, b] = await Promise.all([loginThrottle(ipKey, KEY_LIMITS), loginThrottle(acctKey, ACCOUNT_LIMITS)]);
  if (a.allowed && b.allowed) return { allowed: true };
  return { allowed: false, retryAfterSec: Math.max(a.retryAfterSec ?? 0, b.retryAfterSec ?? 0) || undefined };
}

export async function recordLoginFailure(...keys: string[]): Promise<void> {
  if (!keys.length) return;
  try { await db().from("wa_login_attempts").insert(keys.map(key => ({ key }))); } catch { /* best-effort */ }
}

export async function clearLoginFailures(...keys: string[]): Promise<void> {
  if (!keys.length) return;
  try { await db().from("wa_login_attempts").delete().in("key", keys); } catch { /* best-effort */ }
}
