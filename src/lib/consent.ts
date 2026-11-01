// Cookie consent — the one record of what a visitor agreed to.
//
// Two answers, asked once, with equal weight: "all" (Google Analytics, plus
// remembering an affiliate link for 30 days) or "essential" (only what the site
// needs to work: sign-in, security, the signup in progress). Until a visitor
// answers, they are treated as "essential" — nothing optional loads first and
// asks later.
//
// The answer itself is a strictly-necessary cookie: without it the question
// would come back on every page. It is shared across the marketing and app
// hosts (thetalko.in and app.thetalko.in), so one answer covers both — the
// signup page lives on the app host.

export const CONSENT_COOKIE = "talko_consent";
export const CONSENT_MAX_AGE = 60 * 60 * 24 * 180;   // ask again after six months
export const REF_COOKIE = "talko_ref";
export const REF_MAX_AGE = 60 * 60 * 24 * 30;

export type ConsentChoice = "all" | "essential";

/** The stored answer, or null when the visitor hasn't answered. Pure. */
export function parseConsent(v: string | null | undefined): ConsentChoice | null {
  return v === "all" || v === "essential" ? v : null;
}

/**
 * The cookie Domain that spans the marketing site and the app, or undefined to
 * keep a cookie on the current host only (localhost, previews, partner hosts).
 * Pure.
 */
export function sharedCookieDomain(host: string | null | undefined, marketingHost: string | null | undefined): string | undefined {
  const h = (host ?? "").split(":")[0].toLowerCase();
  const base = (marketingHost ?? "").split(":")[0].toLowerCase().replace(/^www\./, "");
  if (!h || !base) return undefined;
  return h === base || h.endsWith(`.${base}`) ? `.${base}` : undefined;
}

/** Read one cookie out of a document.cookie string. Pure. */
export function readCookie(all: string, name: string): string | null {
  for (const part of all.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return part.slice(i + 1).trim(); }
    }
  }
  return null;
}

/** A Set-Cookie-style string for document.cookie. Pure. */
export function cookieString(name: string, value: string, opts: { maxAge: number; domain?: string; secure: boolean }): string {
  return [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    `Max-Age=${opts.maxAge}`,
    "SameSite=Lax",
    ...(opts.domain ? [`Domain=${opts.domain}`] : []),
    ...(opts.secure ? ["Secure"] : []),
  ].join("; ");
}

/** An affiliate code as the signup accepts it, or null. Pure. */
export function cleanRef(v: string | null | undefined): string | null {
  const r = (v ?? "").trim().slice(0, 40);
  return /^[A-Za-z0-9_-]+$/.test(r) ? r : null;
}
