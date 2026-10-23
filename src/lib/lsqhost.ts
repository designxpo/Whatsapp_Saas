// The LeadSquared API host, from a setting a workspace admin types in.
//
// It was used as typed: every LeadSquared call is `${host}/v2/…`, so a host of
// http://10.0.0.5:8080/admin# sent the server to an address inside the network
// with our access and secret keys on the query string — and the "Test" button
// and system status echoed back what came of it, which made it a probe of
// anywhere the server could reach. LeadSquared's API lives on
// api.leadsquared.com and its regional api-<region>.leadsquared.com hosts, so
// only those are accepted; anything else reads as "not configured".

const LSQ_API_HOST = /^api(-[a-z0-9]+)?\.leadsquared\.com$/;

/**
 * "https://<LeadSquared API host>" for a setting that names one, else "".
 *
 * Forgiving about how it was typed — no scheme, http://, a trailing slash or
 * path all resolve to the same https origin — because only the HOST decides
 * where our keys go. Strict about that: a login, a port, or any host that is
 * not LeadSquared's API reads as unset.
 */
export function lsqApiHost(raw: unknown): string {
  const text = String(raw ?? "").trim();
  if (!text) return "";
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
    if (u.protocol !== "https:" && u.protocol !== "http:") return "";
    if (u.username || u.password || u.port) return "";
    return LSQ_API_HOST.test(u.hostname) ? `https://${u.hostname}` : "";
  } catch {
    return "";
  }
}
