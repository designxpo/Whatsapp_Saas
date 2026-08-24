// Regression guards for src/app/sitemap.ts. Both of these were real defects
// that Search Console surfaced as a dozen URLs stuck at "Discovered – currently
// not indexed" with last-crawled 1970-01-01, and both are the kind that come
// back silently the next time someone adds a route.

import { describe, it, expect } from "vitest";
import sitemap from "../../app/sitemap";

const entries = sitemap();

/** Paths that 308-redirect to the app host (see middleware.ts's host split). */
const REDIRECTING = ["/login", "/signup"];

describe("sitemap", () => {
  it("lists no URL that redirects instead of answering 200", () => {
    // A sitemap is a set of canonical destinations. Listing a redirect spends
    // crawl budget on a URL Google will then refuse to index.
    const paths = entries.map(e => new URL(e.url).pathname);
    for (const bad of REDIRECTING) expect(paths).not.toContain(bad);
  });

  it("never stamps lastModified with the current time", () => {
    // The original bug: `new Date()` for every entry meant each fetch claimed
    // all ~45 pages had just changed, which teaches Google to ignore lastmod
    // for the whole site. Any entry within a minute of now is that bug back.
    const now = Date.now();
    for (const e of entries) {
      const t = new Date(e.lastModified as Date).getTime();
      expect(Number.isFinite(t)).toBe(true);
      expect(now - t).toBeGreaterThan(60_000);
    }
  });

  it("gives every entry an absolute https URL on one host, with no duplicates", () => {
    const seen = new Set<string>();
    for (const e of entries) {
      expect(e.url).toMatch(/^https:\/\//);
      expect(seen.has(e.url)).toBe(false);
      seen.add(e.url);
    }
    expect(seen.size).toBe(entries.length);
    expect(new Set(entries.map(e => new URL(e.url).host)).size).toBe(1);
  });

  it("still covers the commercially important pages", () => {
    // The four comparison pages and the hubs are what the 1970-01-01 list was
    // mostly made of — dropping one while fixing the sitemap would be a own-goal.
    const paths = new Set(entries.map(e => new URL(e.url).pathname));
    for (const p of ["/", "/pricing", "/features", "/vs", "/guides", "/about", "/blog", "/affiliate"]) {
      expect(paths).toContain(p);
    }
    expect([...paths].filter(p => p.startsWith("/vs/")).length).toBeGreaterThanOrEqual(4);
  });
});
