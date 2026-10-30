// White-label, Phase 2: resolving the brand for a request or a workspace, and
// keeping each address to its own users.
//
// Everything returns Talko, without a database read, unless white-label is
// switched on (WHITE_LABEL_ENABLED=1). Any lookup failure, including the
// partner migrations not being applied yet, also falls back to Talko: a broken
// lookup must never take the current portal down.

import { headers } from "next/headers";
import { isPlatformOwnerEmail } from "./auth";
import { brandForSlug, brandForTenant } from "./brand-lookup";
import { TALKO_BRAND, partnerSlugFromHost, partnerOrigin, whiteLabelConfig, type Brand } from "./whitelabel";

export { brandForSlug, brandForTenant, brandForEmail } from "./brand-lookup";

async function requestHost(): Promise<string | null> {
  const h = await headers();
  return h.get("host");
}

/**
 * The brand for the current request's address. `unknown` is true on an
 * address shaped like a partner's that no open partner owns; pages show 404.
 */
export async function requestBrand(): Promise<{ brand: Brand; unknown: boolean }> {
  const slug = partnerSlugFromHost(await requestHost(), whiteLabelConfig());
  if (!slug) return { brand: TALKO_BRAND, unknown: false };
  const brand = await brandForSlug(slug);
  return brand ? { brand, unknown: false } : { brand: TALKO_BRAND, unknown: true };
}

/**
 * Who may sign in at an address. Null = allowed. A partner's address admits
 * only users of that partner's workspaces; Talko's address sends a partner's
 * users to their own address. Does nothing while white-label is off.
 */
export async function loginHostRefusal(user: { email: string; tenantId: string }, host: string | null): Promise<string | null> {
  const cfg = whiteLabelConfig();
  if (!cfg.enabled) return null;
  const slug = partnerSlugFromHost(host, cfg);
  if (slug) {
    const here = await brandForSlug(slug);
    if (!here) return "This address isn't active.";
    if (isPlatformOwnerEmail(user.email)) return "The platform owner signs in at the main Talko address.";
    const theirs = await brandForTenant(user.tenantId);
    return theirs.partnerId === here.partnerId ? null : `This account isn't part of ${here.name}.`;
  }
  const theirs = await brandForTenant(user.tenantId);
  return theirs.partnerId && theirs.slug ? `Your workspace signs in at ${partnerOrigin(theirs.slug, cfg)}.` : null;
}

/**
 * For a signed-in page: where this session belongs, if not here. Returns an
 * absolute URL to send the user to, "notfound" for a session that must not see
 * this address at all, or null to carry on.
 */
export async function sessionHostCheck(user: { email: string; tenantId: string } | null): Promise<string | "notfound" | null> {
  const cfg = whiteLabelConfig();
  if (!cfg.enabled || !user) return null;
  const host = await requestHost();
  const refusal = await loginHostRefusal(user, host);
  if (!refusal) return null;
  if (partnerSlugFromHost(host, cfg)) return "notfound";
  const theirs = await brandForTenant(user.tenantId);
  return theirs.slug ? `${partnerOrigin(theirs.slug, cfg)}/login` : null;
}
