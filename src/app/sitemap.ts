import type { MetadataRoute } from "next";
import { POSTS } from "./(site)/_content/site";
import { LEGAL_DOCS } from "./(site)/_content/legal";
import { SITE_URL } from "@/lib/siteurl";

export default function sitemap(): MetadataRoute.Sitemap {
  const routes = ["", "/features", "/industries", "/pricing", "/about", "/blog", "/login", "/signup"].map(path => ({
    url: `${SITE_URL}${path}`,
    changeFrequency: "weekly" as const,
    priority: path === "" ? 1 : 0.7,
  }));
  const posts = POSTS.map(p => ({
    url: `${SITE_URL}/blog/${p.slug}`,
    changeFrequency: "monthly" as const,
    priority: 0.5,
  }));
  const legal = ["/legal", ...LEGAL_DOCS.map(d => `/legal/${d.slug}`)].map(path => ({
    url: `${SITE_URL}${path}`,
    changeFrequency: "yearly" as const,
    priority: 0.3,
  }));
  return [...routes, ...posts, ...legal];
}
