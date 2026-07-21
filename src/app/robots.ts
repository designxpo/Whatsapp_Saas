import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/siteurl";

// Keep the logged-in app surfaces out of every index; allow the public
// marketing site. AI answer-engine crawlers are listed EXPLICITLY (rather than
// relying on the "*" default) so allowing them into the marketing content for
// AEO/GEO is a deliberate, auditable choice — they get the same allow/disallow
// as everyone else. Remove a bot from this list (and add a disallow) if you
// ever want to opt it out.
const APP_DISALLOW = ["/admin", "/api", "/crm", "/g/", "/r/"];
const AI_CRAWLERS = ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-Web", "PerplexityBot", "Google-Extended", "CCBot", "Applebot-Extended", "Bytespider"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: APP_DISALLOW },
      { userAgent: AI_CRAWLERS, allow: "/", disallow: APP_DISALLOW },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
