// Public system status — the ONE real signal available today: the shared
// cron heartbeat that drives every background job (message delivery, AI
// replies, YouTube/Google Reviews polling, broadcasts, sequences). There's no
// independent per-subsystem monitoring, so this reports one honest status
// rather than fabricating separate "per channel" health checks. Deliberately
// its own module (not owner/health.ts) — that route returns per-tenant detail
// that must never be public; this one only ever touches the shared heartbeat.

import { getSetting } from "./store";

export type PublicStatusLevel = "operational" | "degraded" | "down" | "unknown";

export interface PublicStatus {
  level: PublicStatusLevel;
  lastCheckedAt: string;           // now, ISO — when this was computed
  lastHeartbeatAt: string | null;  // last cron tick, ISO, or null if never recorded
  heartbeatAgeMinutes: number | null;
}

// Mirrors the owner health check's own generous window (no vercel.json cron
// on Hobby; GitHub Actions can run late at peak) so this page never
// contradicts what the team sees internally. Exported so
// src/app/api/owner/health/route.ts imports THIS instead of hardcoding its
// own copy of the same number.
export const OPERATIONAL_MAX_MIN = 20;
const DEGRADED_MAX_MIN = 60;

export async function getPublicStatus(): Promise<PublicStatus> {
  const lastHeartbeatAt = (await getSetting<string>("cron_last_tick", "")) || null;
  const now = new Date();
  const heartbeatMs = lastHeartbeatAt ? new Date(lastHeartbeatAt).getTime() : NaN;
  if (!lastHeartbeatAt || !Number.isFinite(heartbeatMs)) {
    // No heartbeat recorded yet, or the stored value isn't a parseable date —
    // report "unknown" rather than letting NaN math silently render as "down".
    return { level: "unknown", lastCheckedAt: now.toISOString(), lastHeartbeatAt: null, heartbeatAgeMinutes: null };
  }
  const heartbeatAgeMinutes = Math.round((now.getTime() - heartbeatMs) / 60_000);
  const level: PublicStatusLevel =
    heartbeatAgeMinutes <= OPERATIONAL_MAX_MIN ? "operational" : heartbeatAgeMinutes <= DEGRADED_MAX_MIN ? "degraded" : "down";
  return { level, lastCheckedAt: now.toISOString(), lastHeartbeatAt, heartbeatAgeMinutes };
}
