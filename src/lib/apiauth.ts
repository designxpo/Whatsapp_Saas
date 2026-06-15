import crypto from "crypto";
import { tenantForApiKey } from "./apikeys";

const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000001";

function constEq(provided: string, expected: string | undefined): boolean {
  if (!expected) return false;
  const a = Buffer.from(provided), b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function bearer(req: Request): string {
  const h = req.headers.get("authorization") ?? "";
  return h.startsWith("Bearer ") ? h.slice(7) : "";
}

export function apiKeyOk(req: Request): boolean {
  return constEq(bearer(req), process.env.BROADCAST_API_KEY);
}

// Resolve the calling tenant for a public-API request. Prefers a per-tenant key
// (ak_live_…), falls back to the legacy shared BROADCAST_API_KEY → default
// tenant. Returns null when neither matches (caller should 401).
export async function apiKeyTenant(req: Request): Promise<string | null> {
  const token = bearer(req);
  if (!token) return null;
  if (token.startsWith("ak_")) return tenantForApiKey(token);
  if (constEq(token, process.env.BROADCAST_API_KEY)) return DEFAULT_TENANT_ID;
  return null;
}

export function cronOk(req: Request): boolean {
  return constEq(bearer(req), process.env.CRON_SECRET);
}
