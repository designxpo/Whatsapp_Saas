import type { Metadata } from "next";
import type { Brand } from "./whitelabel";

/**
 * Page title, description and icon for a partner's portal, replacing every
 * Talko value the root layout sets (title template, description, favicons,
 * social cards). Partner portals are private, so search engines are told to
 * stay out.
 */
export function partnerMetadata(brand: Brand, title?: string): Metadata {
  const full = title ? `${title} — ${brand.name}` : brand.name;
  const icon = brand.logoUrl ? [{ url: brand.logoUrl }] : [];
  return {
    title: { absolute: full },
    description: `${brand.name} customer portal.`,
    icons: { icon, shortcut: icon, apple: icon },
    openGraph: { siteName: brand.name, title: full, description: `${brand.name} customer portal.` },
    robots: { index: false, follow: false },
    alternates: { canonical: null },
  };
}
