// White-label, Phase 2: which brand a request is for.
//
// A partner's portal lives at `<slug>.<base domain>` (thetalko.in by default).
// Everything here is pure and has no imports, so the edge middleware, server
// code and the browser can all use it.
//
// Two locks keep the current portal untouched:
//   1. Nothing white-label happens unless WHITE_LABEL_ENABLED=1.
//   2. Talko's own hosts never resolve to a partner: the bare domain, `app`,
//      `www` and every other reserved name always mean Talko.
// Every caller falls back to TALKO_BRAND, the exact name, logo and copy the
// portal shows today.

export interface Brand {
  /** null = Talko itself. */
  partnerId: string | null;
  slug: string | null;
  name: string;
  /** Absolute or site-relative image URL; null = show the name as text. */
  logoUrl: string | null;
  /** Hex colour for the partner's accent, e.g. "#0d6efd"; null = Talko's own. */
  color: string | null;
  tagline: string | null;
  supportEmail: string | null;
  termsUrl: string | null;
  privacyUrl: string | null;
  /** Pro partners hide the "Powered by Talko" line. */
  poweredBy: boolean;
}

export const TALKO_BRAND: Brand = {
  partnerId: null,
  slug: null,
  name: "Talko AI",
  logoUrl: "/brand/talko-logo.png?v=2",
  color: null,
  tagline: "AI conversations for WhatsApp & Instagram",
  supportEmail: null,
  termsUrl: null,
  privacyUrl: null,
  poweredBy: false,
};

export interface WhiteLabelConfig { enabled: boolean; baseDomain: string }

export function whiteLabelConfig(env: Record<string, string | undefined> = process.env): WhiteLabelConfig {
  return {
    enabled: env.WHITE_LABEL_ENABLED === "1",
    baseDomain: (env.PARTNER_BASE_DOMAIN || "thetalko.in").toLowerCase().replace(/^\.+|\.+$/g, ""),
  };
}

// Names under the base domain that always belong to Talko.
const RESERVED = new Set([
  "app", "www", "api", "admin", "owner", "mail", "email", "support", "help", "status",
  "docs", "blog", "partner", "partners", "talko", "thetalko", "login", "signup", "billing",
]);
const LABEL_RE = /^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/;

/** The partner slug a request host points at, or null for Talko. */
export function partnerSlugFromHost(host: string | null | undefined, cfg: WhiteLabelConfig): string | null {
  if (!cfg.enabled || !host) return null;
  const h = host.toLowerCase().trim().replace(/:\d+$/, "").replace(/\.$/, "");
  const suffix = `.${cfg.baseDomain}`;
  if (!h.endsWith(suffix)) return null;
  const label = h.slice(0, -suffix.length);
  if (!LABEL_RE.test(label) || RESERVED.has(label)) return null;   // also rejects "a.b" (one level only)
  return label;
}

export function partnerOrigin(slug: string, cfg: WhiteLabelConfig): string {
  return `https://${slug}.${cfg.baseDomain}`;
}

const HEX_RE = /^#[0-9a-f]{6}$/i;
const HTTPS_RE = /^https:\/\/[^\s<>"']+$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** What an owner may store as a partner's brand. Pure; drops anything unsafe. */
export interface BrandSettings {
  displayName?: string | null; logoUrl?: string | null; color?: string | null; tagline?: string | null;
  supportEmail?: string | null; termsUrl?: string | null; privacyUrl?: string | null;
}

export function checkBrandSettings(b: BrandSettings): { ok: true; brand: BrandSettings } | { ok: false; error: string } {
  const s = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
  const out: BrandSettings = {
    displayName: s(b.displayName, 60), logoUrl: s(b.logoUrl, 500), color: s(b.color, 7),
    tagline: s(b.tagline, 80), supportEmail: s(b.supportEmail, 200), termsUrl: s(b.termsUrl, 500), privacyUrl: s(b.privacyUrl, 500),
  };
  if (out.logoUrl && !HTTPS_RE.test(out.logoUrl)) return { ok: false, error: "The logo must be an https:// image link." };
  if (out.color && !HEX_RE.test(out.color)) return { ok: false, error: "The colour must be a hex code like #0d6efd." };
  if (out.supportEmail && !EMAIL_RE.test(out.supportEmail)) return { ok: false, error: "That support email doesn't look right." };
  for (const [k, label] of [["termsUrl", "terms"], ["privacyUrl", "privacy policy"]] as const) {
    if (out[k] && !HTTPS_RE.test(out[k]!)) return { ok: false, error: `The ${label} link must start with https://.` };
  }
  return { ok: true, brand: out };
}

/** A partner record plus its stored brand settings → the brand its portal shows. */
export function brandFromPartner(p: { id: string; slug: string; name: string; tier: string; contactEmail?: string | null; brand?: BrandSettings | null }): Brand {
  const b = p.brand ?? {};
  return {
    partnerId: p.id,
    slug: p.slug,
    name: b.displayName || p.name,
    logoUrl: b.logoUrl || null,
    color: b.color || null,
    tagline: b.tagline || null,
    supportEmail: b.supportEmail || p.contactEmail || null,
    termsUrl: b.termsUrl || null,
    privacyUrl: b.privacyUrl || null,
    poweredBy: p.tier !== "pro",
  };
}

/** Replace "Talko AI" (then "Talko") in a piece of copy with the brand's name. Talko's own brand returns it unchanged. */
export function brandCopy(text: string, brand: Pick<Brand, "partnerId" | "name">): string {
  if (!brand.partnerId) return text;
  return text.replace(/Talko AI/g, brand.name).replace(/\bTalko\b/g, brand.name);
}

/** brandCopy applied to every string inside a JSON-able value. Talko's own brand returns the value itself. */
export function brandJson<T>(value: T, brand: Pick<Brand, "partnerId" | "name">): T {
  if (!brand.partnerId) return value;
  const walk = (v: unknown): unknown =>
    typeof v === "string" ? brandCopy(v, brand)
    : Array.isArray(v) ? v.map(walk)
    : v && typeof v === "object" ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, walk(x)]))
    : v;
  return walk(value) as T;
}
