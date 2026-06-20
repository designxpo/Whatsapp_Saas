// Per-tenant daily send cap — derived from each number's Meta tier, kept low.
//
// Multi-tenant: every tenant has its own WhatsApp number(s), each with its own
// Meta "messaging limit tier" (persisted on the channel row as messagingTier by
// recordChannelQuality). Rather than a blind hardcoded cap, the effective cap is
// a SAFE FRACTION of that tier (default 80%) — so a fresh/low-tier number can't
// overshoot Meta (which hurts quality), and the cap rises automatically as Meta
// lifts the tier. Falls back to WA_DAILY_LIMIT when the tier is unknown.
//
// Env:
//   WA_SAFETY_PCT       — % of the Meta tier we actually send (default 80)
//   WA_DAILY_LIMIT      — fallback cap when the tier is unknown (default 900)
//   WA_DAILY_LIMIT_MAX  — optional absolute ceiling regardless of tier (unset = none)

import { tierDailyCap, getDefaultChannel, getChannel } from "./channels";

export const SAFETY_PCT = Math.min(100, Math.max(5, parseInt(process.env.WA_SAFETY_PCT ?? "80", 10) || 80));
export const ENV_FALLBACK = Math.max(1, parseInt(process.env.WA_DAILY_LIMIT ?? "900", 10) || 900);
const HARD_MAX = process.env.WA_DAILY_LIMIT_MAX ? Math.max(1, parseInt(process.env.WA_DAILY_LIMIT_MAX, 10)) : null;
const UNLIMITED = 1_000_000;

// Safe cap = SAFETY_PCT% of the tier's allowance, optionally capped at HARD_MAX.
// Returns null when the tier is unknown (caller falls back to ENV_FALLBACK).
export function safeCapFromTier(tier: string | null | undefined): number | null {
  const n = tierDailyCap(tier);
  if (n == null) return null;
  const base = Number.isFinite(n) ? n : UNLIMITED;
  let cap = Math.floor((base * SAFETY_PCT) / 100);
  if (cap < 1) cap = 1;
  if (HARD_MAX && cap > HARD_MAX) cap = HARD_MAX;
  return cap;
}

export function getDailyCapForTier(tier: string | null | undefined): number {
  return safeCapFromTier(tier) ?? ENV_FALLBACK;
}

// Per-tenant cap from the (stored) Meta tier of a specific channel, or the
// tenant's default WhatsApp number. Channel-scoped because each number has its
// own tier. No live Meta call here — the tier is refreshed by the limits route /
// the quality webhook (recordChannelQuality).
export async function getDailyCap(tenantId: string, channelId?: string | null): Promise<number> {
  const ch = channelId ? await getChannel(channelId, tenantId) : await getDefaultChannel(tenantId);
  return getDailyCapForTier(ch?.messagingTier);
}
