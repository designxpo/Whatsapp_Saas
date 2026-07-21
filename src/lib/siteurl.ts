// Canonical marketing-site origin — single source of truth for sitemap,
// robots, canonical tags, OG/Twitter URLs and JSON-LD.
//
// Self-healing: even if NEXT_PUBLIC_SITE_URL is (mis)configured to the apex
// host, we normalize to the www host that actually serves traffic (apex 308-
// redirects to www), so canonicals/sitemap never point at a non-serving URL.
// Also strips any trailing slash. If you ever flip the canonical host to the
// apex, change WWW_HOST below.

const APEX_HOST = "thetalko.in";
const WWW_HOST = "www.thetalko.in";

function normalize(raw: string): string {
  let url = raw.trim().replace(/\/+$/, "");
  try {
    const u = new URL(url);
    u.protocol = "https:";
    if (u.host === APEX_HOST) u.host = WWW_HOST;   // apex → www (the serving host)
    url = u.origin;
  } catch {
    /* leave as-is if it isn't a parseable URL */
  }
  return url;
}

export const SITE_URL = normalize(process.env.NEXT_PUBLIC_SITE_URL ?? `https://${WWW_HOST}`);
