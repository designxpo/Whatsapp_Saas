// Where to go after signing in (?next=/support), kept on this site.
//
// The login page used to accept anything matching /^\/(?![/\\])/. That turns
// away "//evil.com" and "/\evil.com", but not "/<TAB>/evil.com": URL parsers
// delete tabs and newlines before reading a URL, so it becomes "//evil.com" —
// another site — after the check has already said yes. A real login then
// delivered the person to a page made to look like ours.
//
// So the value is resolved the way the browser will resolve it, and only kept
// if it is still on our origin.

const BASE = "https://same-origin.invalid";

export function safeNext(raw: string | null | undefined, fallback = "/admin"): string {
  if (!raw || !raw.startsWith("/")) return fallback;
  try {
    const u = new URL(raw, BASE);
    if (u.origin !== BASE) return fallback;
    return u.pathname + u.search + u.hash;
  } catch {
    return fallback;
  }
}
