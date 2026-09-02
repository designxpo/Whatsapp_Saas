"use client";

import { useEffect } from "react";
import Script from "next/script";
import { GA_ID, planFromHref, track } from "@/lib/analytics";

// The GA4 tag, plus the one site-wide listener that turns trial CTAs into a
// measurable step. Mounted by (site)/layout.tsx and signup/layout.tsx only —
// see the scope note in lib/analytics.ts for why the root layout is excluded
// and why /signup needs its own mount.
//
// No manual page_view on route change: GA4's enhanced measurement listens to
// History API pushState/replaceState, which is exactly what the App Router
// uses, so client-side navigations are counted without our help. Sending them
// ourselves as well would double-count every page after the first.
export function GoogleAnalytics() {
  // Every "Start free trial" button on the site is a plain <Link> rendered by
  // the shared server-component Button in (site)/_components/ui.tsx. Rather
  // than convert that component to a client one and thread an onClick through
  // every call site, one delegated listener at the root catches all of them —
  // hero, pricing grid, nav, CTA band, and any added later, for free.
  useEffect(() => {
    if (!GA_ID) return;
    const onClick = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement | null)?.closest?.("a");
      if (!anchor) return;
      const plan = planFromHref(anchor.getAttribute("href"));
      if (!plan) return;
      // `location` records WHERE the intent was formed, which is the whole
      // point: /pricing converting worse than the homepage is actionable,
      // "someone clicked a plan" on its own is not.
      track("select_plan", { plan, location: window.location.pathname });
    };
    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true });
  }, []);

  if (!GA_ID) return null;
  return (
    <>
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="afterInteractive" />
      <Script id="ga-init" strategy="afterInteractive">
        {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}
gtag('js',new Date());gtag('config','${GA_ID}');`}
      </Script>
    </>
  );
}
