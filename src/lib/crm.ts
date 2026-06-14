import crypto from "crypto";

// Auth for /api/crm/* — two callers, two credentials:
//   1. Server-to-server (LeadSquared webhooks/automations): Authorization: Bearer <CRM_API_KEY>
//   2. The embeddable chat panel (/crm/chat): x-crm-token header or ?token= <CRM_PANEL_TOKEN>
export function crmAuthorized(req: Request): boolean {
  const apiKey = process.env.CRM_API_KEY ?? "";
  const panelToken = process.env.CRM_PANEL_TOKEN ?? "";

  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const headerToken = req.headers.get("x-crm-token") ?? "";
  const queryToken = new URL(req.url).searchParams.get("token") ?? "";

  const eq = (a: string, b: string) =>
    a.length > 0 && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

  if (apiKey && eq(bearer, apiKey)) return true;
  if (panelToken && (eq(headerToken, panelToken) || eq(queryToken, panelToken))) return true;
  return false;
}
