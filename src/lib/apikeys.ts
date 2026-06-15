// Per-tenant public API keys. The full key is shown ONCE at creation; only its
// SHA-256 hash is stored. verifyApiKey resolves the calling tenant from the key.

import crypto from "crypto";
import { db } from "./supabase";

export interface ApiKeyRow { id: string; name: string; prefix: string; lastUsedAt: string | null; revoked: boolean; createdAt: string }

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

// Create a key → returns the plaintext ONCE (never recoverable afterwards).
export async function createApiKey(tenantId: string, name: string): Promise<{ key: string; row: ApiKeyRow }> {
  const secret = crypto.randomBytes(24).toString("hex");      // 48 hex chars
  const key = `ak_live_${secret}`;
  const prefix = `ak_live_${secret.slice(0, 4)}…`;
  const { data, error } = await db().from("wa_api_keys").insert({
    tenant_id: tenantId, name: name.trim() || "API key", prefix, key_hash: sha256(key),
  }).select().single();
  if (error) throw error;
  const r = data as Record<string, unknown>;
  return { key, row: { id: r.id as string, name: r.name as string, prefix: r.prefix as string, lastUsedAt: null, revoked: false, createdAt: r.created_at as string } };
}

export async function listApiKeys(tenantId: string): Promise<ApiKeyRow[]> {
  const { data } = await db().from("wa_api_keys").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false });
  return (data ?? []).map(r => ({
    id: r.id as string, name: r.name as string, prefix: r.prefix as string,
    lastUsedAt: (r.last_used_at as string | null) ?? null, revoked: (r.revoked as boolean) ?? false, createdAt: r.created_at as string,
  }));
}

export async function revokeApiKey(id: string, tenantId: string): Promise<void> {
  await db().from("wa_api_keys").update({ revoked: true }).eq("id", id).eq("tenant_id", tenantId);
}

// Resolve the tenant for a presented key (null if unknown/revoked). Best-effort
// stamps last_used_at. Returns null gracefully if the table doesn't exist yet.
export async function tenantForApiKey(key: string): Promise<string | null> {
  if (!key.startsWith("ak_")) return null;
  try {
    const { data } = await db().from("wa_api_keys").select("id, tenant_id, revoked").eq("key_hash", sha256(key)).maybeSingle();
    if (!data || (data.revoked as boolean)) return null;
    void db().from("wa_api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", data.id as string).then(() => undefined, () => undefined);
    return data.tenant_id as string;
  } catch { return null; }
}
