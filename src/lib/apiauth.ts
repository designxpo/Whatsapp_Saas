import { DEFAULT_TENANT_ID } from "./tenant";
import crypto from "crypto";
import { tenantForApiKey } from "./apikeys";


export function constEq(provided: string, expected: string | undefined): boolean {
  if (!expected) return false;
  const a = Buffer.from(provided), b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Verifies a Resend webhook request, which is Svix under the hood — done by
// hand rather than pulling the `svix` package in for three headers' worth of
// HMAC (matches how verifyMetaSignature above and verifySignedRequest below
// both do their own signing rather than reaching for a library). FAIL-CLOSED:
// a missing secret, missing headers, an expired timestamp (>5 min — bounds how
// long a captured request stays replayable) or a mismatched signature all
// reject. Algorithm, per Svix's docs: sign `{id}.{timestamp}.{raw body}` with
// HMAC-SHA256 keyed by the part of WEBHOOK_SECRET after "whsec_", base64-
// decoded; svix-signature carries one or more space-separated "v1,<sig>"
// entries — a request is valid if ANY of them match (Svix rotates keys by
// sending the payload signed with more than one during a rotation window).
export function verifyResendSignature(raw: string, headers: { id: string | null; timestamp: string | null; signature: string | null }, secret: string | undefined): boolean {
  if (!secret) {
    console.error("[resend webhook] RESEND_WEBHOOK_SECRET not configured — rejecting (fail-closed)");
    return false;
  }
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;   // 5 min tolerance
  const keyPart = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  let key: Buffer;
  try { key = Buffer.from(keyPart, "base64"); } catch { return false; }
  const expected = crypto.createHmac("sha256", key).update(`${id}.${timestamp}.${raw}`).digest("base64");
  return signature.split(" ").some(entry => {
    const sig = entry.startsWith("v1,") ? entry.slice(3) : entry;
    return constEq(sig, expected);
  });
}

// Verifies Meta's X-Hub-Signature-256 over the RAW request body. FAIL-CLOSED:
// a missing/empty app secret rejects the request (never processes unsigned
// payloads). Constant-time compare. Pass the exact bytes read via req.text().
export function verifyMetaSignature(raw: string, sigHeader: string | null, secret: string | undefined): boolean {
  if (!secret) {
    console.error("[webhook] Meta app secret not configured — rejecting (fail-closed)");
    return false;
  }
  const sig = sigHeader ?? "";
  if (!sig.startsWith("sha256=")) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(raw, "utf8").digest("hex");
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Parse + verify Meta's `signed_request` (data-deletion & deauthorize callbacks).
// Format: "<base64url HMAC-SHA256 sig>.<base64url JSON payload>", where the sig is
// HMAC of the *encoded payload string* keyed by the app secret. FAIL-CLOSED: any
// missing secret / malformed input / bad signature returns null. Returns the
// decoded payload object on success (contains user_id, issued_at, …).
export function verifySignedRequest(signed: string, secret: string | undefined): Record<string, unknown> | null {
  if (!secret || !signed || !signed.includes(".")) return null;
  const [encSig, encPayload] = signed.split(".", 2);
  if (!encSig || !encPayload) return null;
  let provided: Buffer;
  try { provided = Buffer.from(encSig, "base64url"); } catch { return null; }
  const expected = crypto.createHmac("sha256", secret).update(encPayload).digest();
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) return null;
  try {
    return JSON.parse(Buffer.from(encPayload, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch { return null; }
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
