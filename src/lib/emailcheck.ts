// Local, privacy-safe email quality check — format + disposable-domain + common
// typo detection, entirely in-process. The email NEVER leaves the system (no
// third-party validation API), so there's no PII-sharing concern.

const FORMAT_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The most common disposable / throwaway inbox providers. Not exhaustive (that's
// impossible offline) but it catches the bulk of fake-trial signups.
const DISPOSABLE = new Set([
  "mailinator.com", "guerrillamail.com", "guerrillamail.info", "10minutemail.com", "tempmail.com",
  "temp-mail.org", "throwawaymail.com", "yopmail.com", "getnada.com", "nada.email", "trashmail.com",
  "sharklasers.com", "grr.la", "maildrop.cc", "mailnesia.com", "dispostable.com", "fakeinbox.com",
  "tempinbox.com", "mohmal.com", "emailondeck.com", "spam4.me", "mailcatch.com", "discard.email",
  "mytemp.email", "moakt.com", "tempmailo.com", "1secmail.com", "burnermail.io",
]);

// Common domain typos → the intended domain, for a gentle "did you mean" nudge.
const TYPOS: Record<string, string> = {
  "gmial.com": "gmail.com", "gmai.com": "gmail.com", "gmail.co": "gmail.com", "gmail.con": "gmail.com",
  "gnail.com": "gmail.com", "gmail.cm": "gmail.com", "gmaill.com": "gmail.com",
  "yahoo.co": "yahoo.com", "yaho.com": "yahoo.com", "yahooo.com": "yahoo.com",
  "hotmial.com": "hotmail.com", "hotmai.com": "hotmail.com", "hotmail.co": "hotmail.com",
  "outlook.co": "outlook.com", "outook.com": "outlook.com", "outlok.com": "outlook.com",
  "rediffmail.co": "rediffmail.com", "rediff.com": "rediffmail.com",
};

export interface EmailCheck { ok: boolean; reason?: "format" | "disposable"; suggestion?: string }

// Assess an email. `ok:false` with reason "format" (not an email) or "disposable"
// (a throwaway inbox). `ok:true` may still carry a `suggestion` when the domain
// looks like a typo of a common provider.
export function checkEmail(email: string): EmailCheck {
  const e = (email || "").trim().toLowerCase();
  if (!FORMAT_RE.test(e)) return { ok: false, reason: "format" };
  const domain = e.slice(e.lastIndexOf("@") + 1);
  const fix = TYPOS[domain];
  if (DISPOSABLE.has(domain)) return { ok: false, reason: "disposable", ...(fix ? { suggestion: e.replace(domain, fix) } : {}) };
  if (fix) return { ok: true, suggestion: e.replace(domain, fix) };   // valid, but likely a typo
  return { ok: true };
}
