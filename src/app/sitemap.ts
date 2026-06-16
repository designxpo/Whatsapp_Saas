import type { MetadataRoute } from "next";
import { POSTS } from "./(site)/_content/site";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://whatsapp-saas-navy.vercel.app";

export default function sitemap(): MetadataRoute.Sitemap {
  const routes = ["", "/features", "/pricing", "/about", "/blog", "/login", "/signup"].map(path => ({
    url: `${SITE_URL}${path}`,
    changeFrequency: "weekly" as const,
    priority: path === "" ? 1 : 0.7,
  }));
  const posts = POSTS.map(p => ({
    url: `${SITE_URL}/blog/${p.slug}`,
    changeFrequency: "monthly" as const,
    priority: 0.5,
  }));
  return [...routes, ...posts];
}
