// White-label lookups: which brand a partner address or a workspace shows.
// Database reads only, so background jobs (emails, the chat widget) can use
// them without request context. Talko, with no read at all, while white-label
// is off; Talko too on any lookup failure, including the partner migrations not
// being applied yet.

import { db } from "./supabase";
import { DEFAULT_TENANT_ID } from "./tenant";
import { logError } from "./errors";
import { TALKO_BRAND, brandFromPartner, whiteLabelConfig, type Brand, type BrandSettings } from "./whitelabel";

const TTL = 60_000;
const slugCache = new Map<string, { at: number; v: Brand | null }>();
const tenantCache = new Map<string, { at: number; v: Brand }>();

const COLS = "id,slug,name,tier,status,contact_email,brand";

function toBrand(r: Record<string, unknown>): Brand | null {
  if (r.status === "closed") return null;
  return brandFromPartner({
    id: r.id as string, slug: r.slug as string, name: r.name as string, tier: r.tier as string,
    contactEmail: (r.contact_email as string | null) ?? null, brand: (r.brand as BrandSettings | null) ?? {},
  });
}

/** The brand at `<slug>.<base>`, or null when no open partner has that address. */
export async function brandForSlug(slug: string): Promise<Brand | null> {
  const hit = slugCache.get(slug);
  if (hit && Date.now() - hit.at < TTL) return hit.v;
  let v: Brand | null = null;
  try {
    const { data, error } = await db().from("wa_partners").select(COLS).eq("slug", slug).maybeSingle();
    if (error) throw error;
    v = data ? toBrand(data as Record<string, unknown>) : null;
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
      const { data: p, error: pErr } = await db().from("wa_partners").select(COLS).eq("id", pid).maybeSingle();
      if (pErr) throw pErr;
      v = (p && toBrand(p as Record<string, unknown>)) || TALKO_BRAND;
    }
  } catch (e) { logError("whitelabel.brandForTenant", e, { tenantId }); }
  tenantCache.set(tenantId, { at: Date.now(), v });
  return v;
}

/** The brand for the user who owns this email (sign-in codes and the like). */
export async function brandForEmail(email: string): Promise<Brand> {
  if (!whiteLabelConfig().enabled || !email) return TALKO_BRAND;
  try {
    const { data } = await db().from("wa_users").select("tenant_id").ilike("email", email.trim()).limit(1).maybeSingle();
    return brandForTenant((data as { tenant_id?: string } | null)?.tenant_id);
  } catch { return TALKO_BRAND; }
}
