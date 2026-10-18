import { queryTokenCandidates } from "./querytoken";
import crypto from "crypto";

// Auth for /api/crm/* — two callers, two credentials:
//   1. Server-to-server (LeadSquared webhooks/automations): Authorization: Bearer <CRM_API_KEY>
//   2. The embeddable chat panel (/crm/chat): x-crm-token header
//
// ── About ?token=, which is still accepted ──────────────────────────────────
//
// A secret in a query string ends up in places a secret should not be: Vercel
// and Cloudflare access logs, browser history, and the Referer on the way out.
// Referrer-Policy covers the last of those; nothing covers the logs.
//
// It cannot simply be dropped. The panel is embedded by LeadSquared as an
// iframe whose src is configured in LSQ ("/crm/chat?phone={{Lead Phone}}&
// token=…"), and an iframe src cannot carry a header — so the PAGE has to be
// reachable that way or the counselor panel goes blank.
//
// What the page does next is already right: every /api/crm/* call it makes
// sends x-crm-token, and nothing in this codebase calls the API with ?token=.
// So the query parameter is dead weight on the API — but it may not be dead
// for somebody's LSQ automation, which we cannot see from here, and turning a
// working integration into a silent 401 is a failure mode this project has
// already paid for once.
//
// Hence: still accepted, but every use is logged, so the question "is anything
// still doing this?" can be answered from the logs instead of guessed at. Once
// they are quiet, set CRM_QUERY_TOKEN=off and the parameter stops working.
export function crmAuthorized(req: Request): boolean {
  const apiKey = process.env.CRM_API_KEY ?? "";
  const panelToken = process.env.CRM_PANEL_TOKEN ?? "";

  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const headerToken = req.headers.get("x-crm-token") ?? "";

  const eq = (a: string, b: string) =>
    a.length > 0 && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

  if (apiKey && eq(bearer, apiKey)) return true;
  if (panelToken && eq(headerToken, panelToken)) return true;

  // Only reached when neither header authenticated, so the cost of parsing the
  // URL is paid on the failing path rather than on every call.
  if (panelToken && queryTokenAllowed()) {
    // Every form the credential can arrive in, including the one LeadSquared
    // actually sends — see querytoken.ts. Compared, never trusted.
    const offered = queryTokenCandidates(req.url);
    if (offered.some(t => eq(t, panelToken))) {
      // The path is what identifies the caller worth chasing; the token is
      // never logged, only the fact that one arrived this way.
      console.warn(`[crm] DEPRECATED: authenticated by ?token= — ${new URL(req.url).pathname}. Move this caller to the x-crm-token header; set CRM_QUERY_TOKEN=off once none remain.`);
      return true;
    }
  }
  return false;
}

// Default ON. Off is opt-in because the callers that would break are outside
// this repository, and the operator is the only one who can know they are gone.
function queryTokenAllowed(): boolean {
  return (process.env.CRM_QUERY_TOKEN ?? "").trim().toLowerCase() !== "off";
}
