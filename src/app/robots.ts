import type { MetadataRoute } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://whatsapp-saas-navy.vercel.app";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{
      userAgent: "*",
      allow: "/",
      // Keep the app surfaces out of the index — only the marketing site.
      disallow: ["/admin", "/api", "/crm", "/g/", "/r/"],
    }],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
