import type { MetadataRoute } from "next";
import { POSTS, COMPETITORS } from "./(site)/_content/site";
import { INDUSTRIES } from "./(site)/_content/industries";
import { LEGAL_DOCS, LEGAL_VERSION } from "./(site)/_content/legal";
import { GUIDES } from "./(site)/_content/guides";
import {
  FEATURES_SEO, PRICING_SEO, ABOUT_SEO, BLOG_SEO, GUIDES_SEO,
  STATUS_SEO, INDUSTRIES_SEO, CONTACT_SEO, EXTENSION_SEO, AFFILIATE_SEO,
} from "./(site)/_content/pageseo";
import { SITE_URL } from "@/lib/siteurl";

// Two rules this file exists to get right, both learned from Search Console
// reporting a dozen sitemap URLs as "Discovered – currently not indexed" with a
// last-crawled date of 1970-01-01 (i.e. never fetched at all):
//
// 1. EVERY URL HERE MUST RETURN 200. A sitemap is a set of canonical
//    destinations, not a list of links. /login and /signup used to be listed
//    and they 308 to the app host (see middleware.ts's host split), so Google
//    was being asked to index a redirect — which it correctly refuses to do,
//    while still spending crawl budget discovering it.
//
// 2. lastModified MUST BE TRUE. It was previously `new Date()` for everything
//    except blog posts, so every fetch of this sitemap claimed all ~45 pages had
//    changed that second. Google's documented response to a lastmod it can prove
//    is unreliable is to stop trusting the field for the whole site — which
//    removes the only signal it has for scheduling a re-crawl. Real editorial
//    dates already existed in _content/pageseo.ts (they drive the visible "Last
//    updated" line and dateModified in each page's WebPage schema); this file
//    now reads the same ones, so a page's sitemap entry and its on-page date can
//    never disagree.
//
// Deliberately omitted: `priority`, which Google has publicly ignored for years,
// and which was only ever noise here.

/**
 * Content with no per-page editorial date of its own (the homepage, the /vs and
 * /guides hubs and their children, the industry pages). A FIXED date, not
 * `new Date()` — bump it when that content materially changes, the same
 * discipline `updated` in pageseo.ts already uses. A date that is merely stale
 * costs nothing; one that is always "now" costs the trust of every other date.
 */
const CONTENT_REVISION = "2026-08-21";

/** Safe ISO → Date. Falls back to CONTENT_REVISION rather than to "now". */
function on(iso: string | undefined): Date {
  const t = Date.parse(iso ?? "");
  return new Date(Number.isFinite(t) ? t : Date.parse(CONTENT_REVISION));
}

export default function sitemap(): MetadataRoute.Sitemap {
  // Static routes paired with the editorial date that already governs them.
  // /vs and /changelog have no `updated` of their own (a changelog's real date
  // is its newest entry, which isn't modelled), so they take the revision date.
  const STATIC: [path: string, updated: string | undefined][] = [
    ["", CONTENT_REVISION],
    ["/features", FEATURES_SEO.updated],
    ["/extension", EXTENSION_SEO.updated],
    ["/affiliate", AFFILIATE_SEO.updated],
    ["/industries", INDUSTRIES_SEO.updated],
    ["/pricing", PRICING_SEO.updated],
    ["/about", ABOUT_SEO.updated],
    ["/blog", BLOG_SEO.updated],
    ["/vs", CONTENT_REVISION],
    ["/guides", GUIDES_SEO.updated],
    ["/changelog", CONTENT_REVISION],
    ["/status", STATUS_SEO.updated],
    ["/contact", CONTACT_SEO.updated],
  ];

  const routes = STATIC.map(([path, updated]) => ({
    url: `${SITE_URL}${path}`,
    lastModified: on(updated),
    changeFrequency: "weekly" as const,
  }));

  // Per-competitor comparison pages ("Talko AI vs X" / "X alternative").
  const comparisons = COMPETITORS.map(c => ({
    url: `${SITE_URL}/vs/${c.slug}`, lastModified: on(CONTENT_REVISION), changeFrequency: "monthly" as const,
  }));

  // Per-industry landing pages (hub-and-spoke).
  const industries = INDUSTRIES.map(i => ({
    url: `${SITE_URL}/industries/${i.slug}`, lastModified: on(CONTENT_REVISION), changeFrequency: "monthly" as const,
  }));

  const posts = POSTS.map(p => ({
    url: `${SITE_URL}/blog/${p.slug}`,
    lastModified: on(p.dateModified ?? p.date),
    changeFrequency: "monthly" as const,
  }));

  // Every legal document is versioned together, so they share one honest date.
  const legal = ["/legal", ...LEGAL_DOCS.map(d => `/legal/${d.slug}`)].map(path => ({
    url: `${SITE_URL}${path}`, lastModified: on(LEGAL_VERSION), changeFrequency: "yearly" as const,
  }));

  const guides = [...GUIDES.map(g => g.slug), "troubleshooting"].map(slug => ({
    url: `${SITE_URL}/guides/${slug}`, lastModified: on(CONTENT_REVISION), changeFrequency: "monthly" as const,
  }));

  // NOTE: /login and /signup are intentionally absent — both 308-redirect to the
  // app host, and a sitemap must only list URLs that answer 200. Adding them
  // back would re-create the "Discovered – currently not indexed" entry for
  // /login that prompted this rewrite.
  return [...routes, ...industries, ...comparisons, ...posts, ...legal, ...guides];
}
