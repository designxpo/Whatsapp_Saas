// Google Analytics 4 — the one place event names and the gtag call live.
//
// Scope: the MARKETING funnel only. The tag is mounted by (site)/layout.tsx
// and signup/layout.tsx, never by the root layout — so it is absent from the
// authenticated portal under /admin, whose URLs carry tenant and conversation
// ids we have no business shipping to Google.
//
// /signup deserves special mention: middleware.ts serves it on the APP host
// (app.thetalko.in), not the marketing host, and it inherits the ROOT layout
// rather than the (site) one. A "marketing pages only" tag would therefore see
// every pricing page view and not one single conversion. Hence the second
// mount point, and hence the cross-domain requirement — both thetalko.in and
// app.thetalko.in must be listed under the stream's "Configure your domains",
// or GA4 files each signup as a self-referral and every acquisition source is
// lost at the domain hop.

/** Empty (the normal case in development) disables the tag entirely. */
export const GA_ID = process.env.NEXT_PUBLIC_GA_ID ?? "";

// GA4 gives its own recommended event names special reporting treatment, so
// those are used wherever one fits: `sign_up`, `login` and `generate_lead` are
// GA4's; `sign_up_start`, `select_plan` and `affiliate_signup` are ours, since
// GA4 has no equivalent for a funnel step, a plan choice or a second audience.
export type TrackEvent =
  | "sign_up_start"      // signup form submitted, verification code sent
  | "sign_up"            // code confirmed — the account now exists
  | "select_plan"        // a "start free trial" CTA clicked anywhere on the site
  | "affiliate_signup"   // affiliate program joined
  | "generate_lead"      // contact form submitted
  | "login";

type Params = Record<string, string | number | boolean | undefined>;

declare global {
  interface Window { gtag?: (...args: unknown[]) => void }
}

/**
 * Fire an event, or do nothing at all.
 *
 * Silence is the correct behaviour in more cases than not: server rendering,
 * local development with no GA_ID, an ad blocker, a privacy extension, or a
 * future consent banner that hasn't been accepted. None of those are errors,
 * and none of them may break the form the event was attached to — so this
 * never throws and never returns a failure for a caller to handle.
 */
export function track(name: TrackEvent, params?: Params): void {
  if (typeof window === "undefined" || !window.gtag) return;
  try {
    window.gtag("event", name, params ?? {});
  } catch {
    /* analytics must never take a user flow down with it */
  }
}

/**
 * The plan a "/signup?plan=…" link is selling, or null.
 *
 * Every pricing CTA in _content/site.ts points at /signup?plan=<Name>, so this
 * is what turns an anonymous click into "which tier did they want" — read both
 * at click time (select_plan) and again on the signup page itself, so a plan is
 * still attributed when someone lands on that URL directly from a shared link.
 *
 * Deliberately tolerant of the junk a real href can be: a bare path, a full
 * URL, a hash, an empty string. Anything that isn't a /signup link with a
 * non-empty plan is null rather than an exception.
 */
export function planFromHref(href: string | null | undefined): string | null {
  if (!href) return null;
  try {
    // A relative href needs SOME base to parse; the value is discarded.
    const url = new URL(href, "https://x.invalid");
    if (url.pathname.replace(/\/+$/, "") !== "/signup") return null;
    const plan = url.searchParams.get("plan")?.trim();
    return plan ? plan : null;
  } catch {
    return null;
  }
}
