// Stage 1 — read what the competition has published.
//
// Sitemaps, not scraping. Every one of these companies publishes a sitemap
// because they want to be indexed, so it is both the cheapest and the most
// complete list of their pages — and reading a file they advertise in
// robots.txt is a different act from crawling a site that did not invite it.
// Titles come from the pages themselves, fetched slowly and in small batches.

import type { CompetitorPages, Page } from "../../src/lib/contentgaps.ts";

/** The comparison set already modelled in _content/site.ts, plus their domains. */
export const COMPETITOR_SITES: { name: string; domain: string }[] = [
  { name: "WATI", domain: "wati.io" },
  { name: "AiSensy", domain: "aisensy.com" },
  { name: "Interakt", domain: "interakt.shop" },
  { name: "Respond.io", domain: "respond.io" },
  { name: "ManyChat", domain: "manychat.com" },
  { name: "Tidio", domain: "tidio.com" },
];

const UA = "TalkoAI-ContentResearch/1.0 (+https://www.thetalko.in; respects robots.txt)";
const TIMEOUT_MS = 20_000;
/** Per competitor. Enough to see their content strategy, not their whole site. */
const MAX_PAGES = 120;

async function get(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    return r.ok ? await r.text() : null;
  } catch { return null; }
}

/** <loc> values from a sitemap, following one level of sitemap index. */
async function sitemapUrls(domain: string): Promise<string[]> {
  const roots = [`https://${domain}/sitemap.xml`, `https://${domain}/sitemap_index.xml`];
  for (const root of roots) {
    const xml = await get(root);
    if (!xml) continue;
    const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map(m => m[1]);
    if (!locs.length) continue;
    // A sitemap index points at more sitemaps. Follow the ones most likely to
    // hold articles rather than every product and pricing page.
    const nested = locs.filter(u => u.endsWith(".xml"));
    if (nested.length) {
      const interesting = nested.filter(u => /blog|post|article|resource|guide/i.test(u)).slice(0, 3);
      const out: string[] = [];
      for (const s of (interesting.length ? interesting : nested.slice(0, 2))) {
        const child = await get(s);
        if (child) out.push(...[...child.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map(m => m[1]));
      }
      if (out.length) return out;
    }
    return locs;
  }
  return [];
}

const TITLE = /<title[^>]*>([\s\S]*?)<\/title>/i;
const decode = (s: string) => s
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;|&rsquo;/g, "'").replace(/&nbsp;/g, " ")
  .replace(/\s+/g, " ").trim();

/**
 * Editorial pages only. A competitor's /pricing and /integrations tell us
 * nothing about what their audience searches for; their articles do.
 *
 * The path list is wider than it looks like it needs to be because a dry run
 * returned ZERO pages for AiSensy: they publish under /tutorials/ and
 * /case-studies/, not /blog/, so a /blog/-only filter silently dropped a whole
 * competitor and weakened every consensus count that depends on them.
 */
const isArticle = (u: string) =>
  /\/(blog|resources?|articles?|guides?|learn|academy|tutorials?|case-stud|insights?)\//i.test(u);

/**
 * Translated pages are the same article again. Counting aisensy.com/pt/... as
 * a separate topic inflates one competitor into several and pollutes the
 * ranking with titles the writer cannot read anyway.
 */
const LOCALE = /\/(pt|es|fr|de|it|ar|zh|hi|id|ja|ko|ru|tr|vi|th|nl|pl|pt-br|es-mx)\//i;

export async function crawlCompetitor(name: string, domain: string): Promise<CompetitorPages> {
  const urls = (await sitemapUrls(domain)).filter(u => isArticle(u) && !LOCALE.test(u)).slice(0, MAX_PAGES);
  const pages: Page[] = [];
  // Serial with a pause. This is someone else's server and we are not in a
  // hurry — the job runs overnight and has hours.
  for (const url of urls) {
    const html = await get(url);
    const m = html?.match(TITLE);
    if (m) pages.push({ url, title: decode(m[1]) });
    await new Promise(r => setTimeout(r, 250));
  }
  return { competitor: name, pages };
}

export async function crawlAll(): Promise<CompetitorPages[]> {
  const out: CompetitorPages[] = [];
  for (const { name, domain } of COMPETITOR_SITES) {
    const res = await crawlCompetitor(name, domain);
    console.log(`[crawl] ${name}: ${res.pages.length} article pages`);
    out.push(res);
  }
  return out;
}

/** Our own published pages, read from the live sitemap so it is never stale. */
export async function crawlOurs(origin = "https://www.thetalko.in"): Promise<Page[]> {
  const xml = await get(`${origin}/sitemap.xml`);
  if (!xml) return [];
  const urls = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map(m => m[1]);
  const pages: Page[] = [];
  for (const url of urls) {
    const html = await get(url);
    const m = html?.match(TITLE);
    if (m) pages.push({ url, title: decode(m[1]) });
  }
  console.log(`[crawl] thetalko.in: ${pages.length} pages`);
  return pages;
}
