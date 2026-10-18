// Letting LeadSquared's lead grid call us from a counsellor's browser.
//
// ── Why this is needed at all ───────────────────────────────────────────────
//
// LeadSquared's Custom Lead Action "Call an API" does NOT call from their
// server. It calls from the browser the counsellor is sitting in. So a
// perfectly configured button fails with "Failed to fetch" and nothing
// whatsoever reaches us: the browser asks our endpoint whether
// app-in21.leadsquared.com may call it, gets no answer, and refuses to send
// the request. There is nothing in any log, because there is no request.
//
// That cost an afternoon of checking a configuration that was already right.
//
// ── Why the origin is an allowlist and not "*" ──────────────────────────────
//
// This endpoint sends WhatsApp messages. "*" would let any page on the
// internet make a counsellor's browser fire it, and the credential travels in
// the URL LeadSquared holds, so it is not a secret from the page. Restricting
// the origin means only a LeadSquared tab can make that call.
//
// LeadSquared runs regional hosts (app-in21, app-ap1, app-us11 …), so the rule
// is "a leadsquared.com subdomain over https" rather than one fixed name —
// otherwise this breaks silently the day the account moves region, with the
// same unhelpful "Failed to fetch".
const LSQ_HOST = /^https:\/\/[a-z0-9-]+\.leadsquared\.com$/i;

/** Extra origins for local testing, comma-separated. Never includes "*". */
const extra = (process.env.CRM_CORS_ORIGINS ?? "")
  .split(",").map(s => s.trim()).filter(Boolean);

export function crmOriginAllowed(origin: string | null): boolean {
  if (!origin) return false;
  return LSQ_HOST.test(origin) || extra.includes(origin);
}

/**
 * CORS headers for a CRM endpoint, or none when the origin is not allowed.
 *
 * Returning nothing (rather than a refusal) is deliberate: the browser blocks
 * it either way, and a disallowed origin should learn nothing about us.
 */
export function crmCors(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  if (!crmOriginAllowed(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin!,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-crm-token",
    "Access-Control-Max-Age": "86400",
    // Without this a CDN can hand one origin's allow-header to another.
    "Vary": "Origin",
  };
}

/** The preflight answer. 204 with the headers when allowed, 403 when not. */
export function crmPreflight(req: Request): Response {
  const headers = crmCors(req);
  return Object.keys(headers).length
    ? new Response(null, { status: 204, headers })
    : new Response(null, { status: 403 });
}

/** Copy the CORS headers onto a response the route already built. */
export function withCrmCors(res: Response, req: Request): Response {
  const headers = crmCors(req);
  for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
  return res;
}
