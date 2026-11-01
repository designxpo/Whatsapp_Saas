"use client";

// The cookie question (lib/consent.ts). Asked once, at the bottom of the page,
// without blocking it: "Accept" and "Reject" sit side by side with the same
// size and weight, nothing is pre-chosen, and closing the page without
// answering leaves only the essential cookies. The footer's "Cookie settings"
// reopens it, so a visitor can change their mind as easily as they decided.

import { useEffect, useState } from "react";
import { CONSENT_COOKIE, CONSENT_MAX_AGE, REF_COOKIE, REF_MAX_AGE, cleanRef, cookieString, parseConsent, readCookie, sharedCookieDomain, type ConsentChoice } from "@/lib/consent";
import { GA_ID } from "@/lib/analytics";

const OPEN_EVENT = "talko:consent-open";
export const CONSENT_EVENT = "talko:consent";

declare global {
  interface Window { __twcConsent?: boolean }
}

export function currentConsent(): ConsentChoice | null {
  if (typeof document === "undefined") return null;
  return parseConsent(readCookie(document.cookie, CONSENT_COOKIE));
}

const domain = () => sharedCookieDomain(window.location.host, process.env.NEXT_PUBLIC_MARKETING_HOST);
const secure = () => window.location.protocol === "https:";

function expire(name: string) {
  const d = domain();
  document.cookie = cookieString(name, "", { maxAge: 0, secure: secure() });
  if (d) document.cookie = cookieString(name, "", { maxAge: 0, domain: d, secure: secure() });
}

function choose(choice: ConsentChoice) {
  document.cookie = cookieString(CONSENT_COOKIE, choice, { maxAge: CONSENT_MAX_AGE, domain: domain(), secure: secure() });
  if (choice === "all") {
    // An affiliate link on this very page is remembered now that it's allowed.
    const ref = cleanRef(new URLSearchParams(window.location.search).get("ref"));
    if (ref) document.cookie = cookieString(REF_COOKIE, ref, { maxAge: REF_MAX_AGE, domain: domain(), secure: secure() });
    window.__twcConsent = true;
    window.dispatchEvent(new Event("twc:consent"));
  } else {
    // Changing a "yes" to a "no" takes effect at once: GA stops for this page
    // and its cookies, and the stored affiliate link, are removed.
    if (GA_ID) (window as unknown as Record<string, boolean>)[`ga-disable-${GA_ID}`] = true;
    for (const name of document.cookie.split(";").map(c => c.split("=")[0].trim())) {
      if (name === "_ga" || name.startsWith("_ga_") || name === "_gid" || name === REF_COOKIE) expire(name);
    }
  }
  window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: choice }));
}

export function ConsentBanner() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!currentConsent()) setOpen(true);
    if (currentConsent() === "all") window.__twcConsent = true;
    const reopen = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, reopen);
    return () => window.removeEventListener(OPEN_EVENT, reopen);
  }, []);
  if (!open) return null;

  const pick = (c: ConsentChoice) => { choose(c); setOpen(false); };
  return (
    <div role="region" aria-label="Cookie choices" className="fixed inset-x-3 bottom-3 z-[90] mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700 shadow-xl sm:inset-x-6 sm:bottom-6">
      <p>
        We use cookies the site needs to work. With your OK we&apos;d also use Google Analytics to see which pages help people, and remember an affiliate link for 30 days if you came through one.{" "}
        <a href="/legal/cookies" className="font-semibold text-brand-700 underline">Cookie policy</a>
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" onClick={() => pick("essential")} className="rounded-full border border-slate-300 bg-white px-4 py-2 font-bold text-slate-800 hover:bg-slate-50">Reject</button>
        <button type="button" onClick={() => pick("all")} className="rounded-full border border-slate-300 bg-white px-4 py-2 font-bold text-slate-800 hover:bg-slate-50">Accept</button>
      </div>
    </div>
  );
}

/** "Cookie settings" — reopens the question. For the site footer. */
export function CookieSettingsLink({ className }: { className?: string }) {
  return (
    <button type="button" className={className} onClick={() => window.dispatchEvent(new Event(OPEN_EVENT))}>
      Cookie settings
    </button>
  );
}
