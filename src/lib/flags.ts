// Platform-wide feature flags (owner control plane). Global, not tenant-scoped.
// Reads are cached briefly so hot paths (e.g. signup) don't hit the DB every time.

import { db } from "./supabase";

export interface PlatformFlag { key: string; enabled: boolean; description: string | null; updatedAt: string }

let cache: { at: number; map: Map<string, boolean> } | null = null;
const TTL_MS = 30_000;

async function loadMap(): Promise<Map<string, boolean>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.map;
  const map = new Map<string, boolean>();
  try {
    const { data } = await db().from("wa_platform_flags").select("key, enabled");
    for (const r of data ?? []) map.set(r.key as string, (r.enabled as boolean) ?? true);
  } catch { /* table missing → everything defaults on */ }
  cache = { at: Date.now(), map };
  return map;
}

// Default true → a missing/unset flag never blocks (fail-open for availability).
export async function getFlag(key: string, fallback = true): Promise<boolean> {
  const map = await loadMap();
  return map.has(key) ? map.get(key)! : fallback;
}

export async function listFlags(): Promise<PlatformFlag[]> {
  const { data } = await db().from("wa_platform_flags").select("*").order("key");
  return (data ?? []).map(r => ({
    key: r.key as string, enabled: (r.enabled as boolean) ?? true,
    description: (r.description as string | null) ?? null, updatedAt: r.updated_at as string,
  }));
}

export async function setFlag(key: string, enabled: boolean): Promise<void> {
  await db().from("wa_platform_flags").upsert({ key, enabled, updated_at: new Date().toISOString() }, { onConflict: "key" });
  cache = null;   // bust cache so the change applies immediately
}
