import type { MetadataRoute } from "next";
import { POSTS } from "./(site)/_content/site";
import { INDUSTRIES } from "./(site)/_content/industries";
import { LEGAL_DOCS } from "./(site)/_content/legal";
import { SITE_URL } from "@/lib/siteurl";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const routes = ["", "/features", "/industries", "/pricing", "/about", "/blog"].map(path => ({
    url: `${SITE_URL}${path}`,
    lastModified: now,
    changeFrequency: "weekly" as const,
    priority: path === "" ? 1 : 0.7,
  }));
  // Login/signup: indexable but low value.
  const authRoutes = ["/login", "/signup"].map(path => ({
    url: `${SITE_URL}${path}`, lastModified: now, changeFrequency: "weekly" as const, priority: 0.4,
  }));
  // Per-industry landing pages (hub-and-spoke).
  const industries = INDUSTRIES.map(i => ({
    url: `${SITE_URL}/industries/${i.slug}`, lastModified: now, changeFrequency: "monthly" as const, priority: 0.7,
  }));
  const posts = POSTS.map(p => {
    const t = Date.parse(p.dateModified ?? p.date);
    return {
      url: `${SITE_URL}/blog/${p.slug}`,
      lastModified: Number.isFinite(t) ? new Date(t) : now,
      changeFrequency: "monthly" as const,
      priority: 0.5,
    };
  });
  const legal = ["/legal", ...LEGAL_DOCS.map(d => `/legal/${d.slug}`)].map(path => ({
    url: `${SITE_URL}${path}`, lastModified: now, changeFrequency: "yearly" as const, priority: 0.3,
  }));
  return [...routes, ...industries, ...authRoutes, ...posts, ...legal];
}
