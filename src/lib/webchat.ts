// Website web-chat widget helpers — shared by the public widget endpoints.
//
// The widget runs on the customer's OWN website (a different origin), so the
// public endpoints (/api/widget/*) are cross-origin and unauthenticated. They're
// secured by (1) a per-workspace public site key that routes to one channel and
// (2) an optional per-channel origin allowlist. An empty allowlist allows any
// origin (quick-start / dev); set origins to lock the key to your domains.

import crypto from "crypto";

export type WebchatOrigin = string | null | undefined;

// Normalize an Origin header to scheme://host (drops any path/trailing slash).
function normOrigin(origin: WebchatOrigin): string {
  if (!origin) return "";
  try { const u = new URL(origin); return `${u.protocol}//${u.host}`; }
  catch { return origin.trim().replace(/\/$/, ""); }
}

// True if this request origin may use the channel. Empty allowlist = allow any.
export function originAllowed(origin: WebchatOrigin, allowed: string[]): boolean {
  if (!allowed.length) return true;
  const o = normOrigin(origin);
  if (!o) return false;
  return allowed.some(a => normOrigin(a) === o);
}

// CORS headers for the widget endpoints. Echoes the caller's origin (we've
// already validated it via site key + allowlist), so credentials aren't used.
export function corsHeaders(origin: WebchatOrigin): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

// The conversation identifier for a web-chat visitor. Visitors have no phone;
// the widget generates a UUID and we key the conversation on web:<uuid>.
export function webchatConvId(visitorId: string): string {
  return `web:${visitorId.trim().slice(0, 80)}`;
}

// ── Signed visitor identity (in-portal support widget) ───────────────────────
// When the widget is embedded on OUR OWN portal, the page knows exactly who is
// chatting (workspace + signed-in user). That identity is server-signed into
// the page and echoed back with each widget message, so the support desk can
// show "Acme Beauty · owner@acme.com" instead of "Website visitor". The HMAC
// means a visitor on any external site can't forge someone else's identity —
// unsigned/invalid payloads are simply ignored.
export interface WidgetIdentity { tenantId: string; tenant: string; email: string }

// JSON-array input (no delimiter ambiguity) bound to the widget's site key
// (an identity signed for the support widget can't be replayed onto another
// workspace's widget).
function identitySig(id: WidgetIdentity, siteKey: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(JSON.stringify(["twc-id", siteKey, id.tenantId, id.tenant, id.email])).digest("hex");
}

// Sign an identity for embedding in the portal page (server-side only).
export function signWidgetIdentity(id: WidgetIdentity, siteKey: string): (WidgetIdentity & { sig: string }) | null {
  const s = process.env.ADMIN_JWT_SECRET;
  if (!s || s.length < 32 || !siteKey) return null;
  const clean: WidgetIdentity = { tenantId: id.tenantId.trim(), tenant: id.tenant.trim().slice(0, 80), email: id.email.trim().slice(0, 120) };
  if (!clean.tenantId || !clean.tenant) return null;
  return { ...clean, sig: identitySig(clean, siteKey, s) };
}

// Verify an identity echoed back by the widget. Returns null unless the
// signature matches exactly what the server originally signed for this key.
export function verifyWidgetIdentity(raw: unknown, siteKey: string): WidgetIdentity | null {
  if (!raw || typeof raw !== "object" || !siteKey) return null;
  const { tenantId, tenant, email, sig } = raw as Record<string, unknown>;
  if (typeof tenantId !== "string" || typeof tenant !== "string" || typeof email !== "string" || typeof sig !== "string") return null;
  const s = process.env.ADMIN_JWT_SECRET;
  if (!s || s.length < 32) return null;
  const expect = identitySig({ tenantId, tenant, email }, siteKey, s);
  const a = Buffer.from(sig), b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return { tenantId, tenant, email };
}
