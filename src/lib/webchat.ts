// Website web-chat widget helpers — shared by the public widget endpoints.
//
// The widget runs on the customer's OWN website (a different origin), so the
// public endpoints (/api/widget/*) are cross-origin and unauthenticated. They're
// secured by (1) a per-workspace public site key that routes to one channel and
// (2) an optional per-channel origin allowlist. An empty allowlist allows any
// origin (quick-start / dev); set origins to lock the key to your domains.

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
