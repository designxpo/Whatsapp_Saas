// White-label lookups: which brand a partner address or a workspace shows.
// Database reads only, so background jobs (emails, the chat widget) can use
// them without request context. Talko, with no read at all, while white-label
// is off; Talko too on any lookup failure, including the partner migrations not
// being applied yet.

import { db } from "./supabase";
import { DEFAULT_TENANT_ID } from "./tenant";
import { logError } from "./errors";
import { TALKO_BRAND, brandFromPartner, partnerHostKind, whiteLabelConfig, type Brand, type BrandSettings } from "./whitelabel";

const TTL = 60_000;
const slugCache = new Map<string, { at: number; v: Brand | null }>();
const tenantCache = new Map<string, { at: number; v: Brand }>();

// The domain columns arrive with Phase 6's migration; before it, lookups use the
// shorter list (selectPartner retries without them), so nothing breaks in between.
const COLS = "id,slug,name,tier,status,contact_email,brand,custom_domain,domain_status,email_domain";
const COLS_BEFORE_PHASE6 = "id,slug,name,tier,status,contact_email,brand";

async function selectPartner(col: "slug" | "id" | "custom_domain", value: string): Promise<Record<string, unknown> | null> {
  const q = (cols: string) => {
    const base = db().from("wa_partners").select(cols);
    return (col === "custom_domain" ? base.ilike(col, value) : base.eq(col, value)).maybeSingle();
  };
  let { data, error } = await q(COLS);
  if (error && /custom_domain|domain_status|email_domain/.test(error.message ?? "")) {
    if (col === "custom_domain") return null;
    ({ data, error } = await q(COLS_BEFORE_PHASE6));
  }
  if (error) throw error;
  return (data as Record<string, unknown> | null) ?? null;
}

function toBrand(r: Record<string, unknown>): Brand | null {
  if (r.status === "closed") return null;
  return brandFromPartner({
    id: r.id as string, slug: r.slug as string, name: r.name as string, tier: r.tier as string,
    contactEmail: (r.contact_email as string | null) ?? null, brand: (r.brand as BrandSettings | null) ?? {},
    customDomain: (r.custom_domain as string | null) ?? null, domainStatus: (r.domain_status as string | null) ?? null,
    emailDomain: (r.email_domain as { name?: string; status?: string } | null) ?? null,
  });
}

/** The brand at `<slug>.<base>`, or null when no open partner has that address. */
export async function brandForSlug(slug: string): Promise<Brand | null> {
  const hit = slugCache.get(slug);
  if (hit && Date.now() - hit.at < TTL) return hit.v;
  let v: Brand | null = null;
  try {
    const data = await selectPartner("slug", slug);
    v = data ? toBrand(data) : null;
  } catch (e) { logError("whitelabel.brandForSlug", e, { slug }); }
  slugCache.set(slug, { at: Date.now(), v });
  return v;
}

/** The brand a workspace's users see: its partner's, or Talko's. */
export async function brandForTenant(tenantId: string | null | undefined): Promise<Brand> {
  if (!whiteLabelConfig().enabled || !tenantId || tenantId === DEFAULT_TENANT_ID) return TALKO_BRAND;
  const hit = tenantCache.get(tenantId);
  if (hit && Date.now() - hit.at < TTL) return hit.v;
  let v: Brand = TALKO_BRAND;
  try {
    const { data, error } = await db().from("tenants").select("partner_id").eq("id", tenantId).maybeSingle();
    if (error) throw error;
    const pid = (data as { partner_id?: string | null } | null)?.partner_id;
    if (pid) {
      const p = await selectPartner("id", pid);
      v = (p && toBrand(p)) || TALKO_BRAND;
    }
  } catch (e) { logError("whitelabel.brandForTenant", e, { tenantId }); }
  tenantCache.set(tenantId, { at: Date.now(), v });
  return v;
}

const domainCache = new Map<string, { at: number; v: Brand | null }>();

/** The brand at a partner's own domain, only once that domain is verified. */
export async function brandForDomain(domain: string): Promise<Brand | null> {
  const key = domain.toLowerCase();
  const hit = domainCache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.v;
  let v: Brand | null = null;
  try {
    const data = await selectPartner("custom_domain", key);
    v = data && data.domain_status === "verified" ? toBrand(data) : null;
  } catch (e) { logError("whitelabel.brandForDomain", e, { domain: key }); }
  domainCache.set(key, { at: Date.now(), v });
  return v;
}

/** The brand for a request host: a partner's sub-address or its own domain; null = not a partner address. */
export async function brandForHost(host: string | null | undefined): Promise<{ brand: Brand | null; partnerHost: boolean }> {
  const kind = partnerHostKind(host, whiteLabelConfig());
  if (!kind) return { brand: null, partnerHost: false };
  return { brand: "slug" in kind ? await brandForSlug(kind.slug) : await brandForDomain(kind.domain), partnerHost: true };
}

/** The brand for the user who owns this email (sign-in codes and the like). */
export async function brandForEmail(email: string): Promise<Brand> {
  if (!whiteLabelConfig().enabled || !email) return TALKO_BRAND;
  try {
    const { data } = await db().from("wa_users").select("tenant_id").ilike("email", email.trim()).limit(1).maybeSingle();
    return brandForTenant((data as { tenant_id?: string } | null)?.tenant_id);
  } catch { return TALKO_BRAND; }
}
