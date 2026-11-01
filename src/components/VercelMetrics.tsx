"use client";

// Vercel Analytics and Speed Insights — cookieless page counts and Core Web
// Vitals — with every address passed through redactUrl first, so workspace and
// conversation ids in /admin URLs, and query strings, never leave the browser.
// A client component because beforeSend is a function, which the server root
// layout can't pass down.

import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { redactUrl } from "@/lib/analytics";

export function VercelMetrics() {
  return (
    <>
      <Analytics beforeSend={e => ({ ...e, url: redactUrl(e.url) })} />
      <SpeedInsights beforeSend={e => ({ ...e, url: redactUrl(e.url) })} />
    </>
  );
}
