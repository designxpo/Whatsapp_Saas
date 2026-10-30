// White-label emails: the same message, in a partner's brand, for a partner's
// customer. Talko's own brand returns the email exactly as given.
//
// For a partner it changes four things:
//   - every "Talko AI" / "Talko" in the words becomes the partner's name;
//   - the header and footer show the partner (renderEmail's `brand`);
//   - links point at the partner's address, and links to Talko's own website
//     (guides, contact) are dropped, since the partner's address serves only
//     the portal;
//   - the sender name becomes the partner's.

import type { EmailOptions } from "./emailtemplate";
import { brandForTenant } from "./brand-lookup";
import { SITE_URL } from "./siteurl";
import { brandCopy, brandJson, partnerOrigin, whiteLabelConfig, type Brand } from "./whitelabel";

export interface BrandedEmail { opts: EmailOptions; siteUrl: string; subject: string; fromName?: string }

// Paths a partner's address actually serves (middleware.ts).
const PORTAL_LINK = /^\/(login|admin)(\/|\?|$)/;

/** Pure: an email for this brand. */
export function applyEmailBrand(brand: Brand, opts: EmailOptions, siteUrl: string, subject: string): BrandedEmail {
  if (!brand.partnerId || !brand.slug) return { opts, siteUrl, subject };
  const site = partnerOrigin(brand.slug, whiteLabelConfig());
  // Words only: links and the unsubscribe token are never rewritten as text.
  const { cta, secondary, unsubscribeHref, ...words } = opts;
  const keep = (l?: { label: string; href: string }) =>
    l && PORTAL_LINK.test(l.href) ? { ...l, label: brandCopy(l.label, brand) } : undefined;
  const branded: EmailOptions = {
    ...brandJson(words, brand),
    brand: { name: brand.name, logoUrl: brand.logoUrl },
    cta: keep(cta),
    secondary: keep(secondary),
    // The unsubscribe endpoint is an API route, served on every address.
    unsubscribeHref: unsubscribeHref?.startsWith(SITE_URL) ? site + unsubscribeHref.slice(SITE_URL.length) : unsubscribeHref,
  };
  return { opts: branded, siteUrl: site, subject: brandCopy(subject, brand), fromName: brand.name };
}

/** The same, for whatever brand a workspace shows (Talko while white-label is off). */
export async function brandEmail(tenantId: string, opts: EmailOptions, siteUrl: string, subject: string): Promise<BrandedEmail> {
  return applyEmailBrand(await brandForTenant(tenantId), opts, siteUrl, subject);
}
