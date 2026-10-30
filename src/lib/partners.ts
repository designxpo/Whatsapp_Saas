// White-label partners: the businesses that run Talko under their own brand.
//
// Phase 1 of the white-label roadmap: the partner records, the link from a
// workspace to its partner, and the audit log. Two kinds share one record:
//   private   — one company using Talko for its own business (Private Label);
//   reseller  — an agency or consultant selling Talko to its own clients.
//
// The isolation rule everything later builds on: a partner's workspaces are
// read only through queries filtered by partner_id in the database, so one
// partner can never be handed another partner's workspace, and the platform's
// default workspace never belongs to anyone (the migration enforces it too).
//
// Schema: supabase/migrations/20261030120000_white_label_partners.sql.

import { db } from "./supabase";
import { DEFAULT_TENANT_ID } from "./tenant";
import { errorMessage } from "./errors";
import { checkBrandSettings, type BrandSettings } from "./whitelabel";

export type PartnerKind = "private" | "reseller";
export type PartnerTier = "standard" | "pro";
export type PartnerStatus = "onboarding" | "active" | "paused" | "closed";

export const PARTNER_KINDS: PartnerKind[] = ["private", "reseller"];
export const PARTNER_TIERS: PartnerTier[] = ["standard", "pro"];
export const PARTNER_STATUSES: PartnerStatus[] = ["onboarding", "active", "paused", "closed"];

export interface Partner {
  id: string; name: string; slug: string;
  kind: PartnerKind; tier: PartnerTier; status: PartnerStatus;
  contactName: string | null; contactEmail: string | null; contactPhone: string | null;
  allowedPlans: string[];
  setupFeeCents: number; monthlyFeeCents: number; depositCents: number;
  wholesalePct: number | null; graceDays: number;
  notes: string | null; createdAt: string; updatedAt: string;
  /** What the partner's portal shows instead of Talko (Phase 2). */
  brand: BrandSettings;
  /** Reseller's own monthly price per plan key, in rupee cents (Phase 3). */
  resalePrices: Record<string, number>;
  // Phase 4 billing. The partner's Razorpay secrets are never mapped here, so
  // they can't reach an API response; partner-billing.ts reads them directly.
  balanceCents: number; billingDay: number; billingState: "ok" | "grace" | "suspended";
  graceUntil: string | null; setupPaidAt: string | null;
  razorpay: { keyId: string | null; connected: boolean };
  customerBilling: CustomerBilling;
}

export interface CustomerBilling { autoLinks: boolean; graceDays: number; autoPause: boolean }
export const CUSTOMER_BILLING_DEFAULTS: CustomerBilling = { autoLinks: false, graceDays: 7, autoPause: false };

export interface PartnerWorkspace {
  id: string; name: string; company: string | null; plan: string;
  status: string; paymentStatus: string | null; createdAt: string;
}

export interface PartnerPricing {
  setupFeeCents: number; monthlyFeeCents: number; depositCents: number;
  wholesalePct: number | null; allowedPlans: string[];
}

const ALL_PAID_PLANS = ["creator", "starter", "creator-pro", "growth", "scale"];

// Prices from the White-Label Business Plan (30 Oct 2026), before GST. Copied
// onto each partner when it is created, so a later change here never rewrites a
// signed deal.
export const PARTNER_DEFAULTS: Record<PartnerKind, Record<PartnerTier, PartnerPricing>> = {
  private: {
    standard: { setupFeeCents: 25_000_00, monthlyFeeCents: 4_999_00, depositCents: 0, wholesalePct: null, allowedPlans: ["growth", "scale"] },
    pro:      { setupFeeCents: 50_000_00, monthlyFeeCents: 9_999_00, depositCents: 0, wholesalePct: null, allowedPlans: ["growth", "scale"] },
  },
  reseller: {
    standard: { setupFeeCents: 50_000_00,   monthlyFeeCents: 9_999_00,  depositCents: 20_000_00, wholesalePct: 50, allowedPlans: ALL_PAID_PLANS },
    pro:      { setupFeeCents: 1_00_000_00, monthlyFeeCents: 19_999_00, depositCents: 40_000_00, wholesalePct: 50, allowedPlans: ALL_PAID_PLANS },
  },
};

// Addresses Talko keeps for itself once partners get `<slug>.thetalko.in`.
const RESERVED_SLUGS = new Set([
  "app", "www", "api", "admin", "owner", "mail", "email", "support", "help", "status",
  "docs", "blog", "partner", "partners", "talko", "thetalko", "login", "signup", "billing",
]);
const SLUG_RE = /^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeSlug(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+/, "").slice(0, 40).replace(/-+$/, "");
}

export interface PartnerInput {
  name?: string; slug?: string; kind?: string; tier?: string;
  contactName?: string | null; contactEmail?: string | null; contactPhone?: string | null;
  allowedPlans?: string[]; setupFeeCents?: number; monthlyFeeCents?: number; depositCents?: number;
  wholesalePct?: number | null; graceDays?: number; notes?: string | null;
  brand?: BrandSettings;
}

type Checked = { ok: true; row: Record<string, unknown> } | { ok: false; error: string };

const isCents = (n: unknown) => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 1_00_00_000_00;
const clean = (s: unknown, max: number) => (typeof s === "string" && s.trim() ? s.trim().slice(0, max) : null);

/**
 * Check a create (no `existing`) or an update, and build the database row. Pure.
 * A new partner takes the business-plan prices for its kind and tier unless the
 * owner typed others. A partner's kind is fixed once created: switching a
 * reseller with client workspaces to Private Label would leave them unbilled.
 */
export function checkPartnerInput(p: PartnerInput, existing?: Pick<Partner, "kind" | "tier">): Checked {
  const row: Record<string, unknown> = {};
  const isNew = !existing;

  if (isNew || p.name !== undefined) {
    const name = clean(p.name, 80);
    if (!name || name.length < 2) return { ok: false, error: "Give the partner a name." };
    row.name = name;
  }

  let kind = existing?.kind;
  if (isNew) {
    if (!PARTNER_KINDS.includes(p.kind as PartnerKind)) return { ok: false, error: "Choose Private Label or Reseller." };
    kind = p.kind as PartnerKind;
    row.kind = kind;
  } else if (p.kind !== undefined && p.kind !== existing!.kind) {
    return { ok: false, error: "A partner's kind can't change. Close this partner and create a new one instead." };
  }

  let tier = existing?.tier ?? "standard";
  if (p.tier !== undefined) {
    if (!PARTNER_TIERS.includes(p.tier as PartnerTier)) return { ok: false, error: "Choose Standard or Pro." };
    tier = p.tier as PartnerTier;
    row.tier = tier;
  } else if (isNew) row.tier = tier;

  if (isNew || p.slug !== undefined) {
    const slug = normalizeSlug(p.slug || (isNew ? String(p.name ?? "") : ""));
    if (!SLUG_RE.test(slug)) return { ok: false, error: "The address needs letters or numbers, like \"brightdental\"." };
    if (RESERVED_SLUGS.has(slug)) return { ok: false, error: `"${slug}" is reserved. Choose another address.` };
    row.slug = slug;
  }

  for (const k of ["contactName", "contactPhone", "notes"] as const) {
    if (p[k] !== undefined) row[k === "contactName" ? "contact_name" : k === "contactPhone" ? "contact_phone" : "notes"] = clean(p[k], k === "notes" ? 2000 : 120);
  }
  if (p.contactEmail !== undefined) {
    const email = clean(p.contactEmail, 200);
    if (email && !EMAIL_RE.test(email)) return { ok: false, error: "That contact email doesn't look right." };
    row.contact_email = email?.toLowerCase() ?? null;
  }

  const defaults = PARTNER_DEFAULTS[kind!][tier];
  const plans = p.allowedPlans ?? (isNew ? defaults.allowedPlans : undefined);
  if (plans !== undefined) {
    if (!Array.isArray(plans) || plans.some(x => typeof x !== "string" || !x.trim())) return { ok: false, error: "Allowed plans must be plan keys." };
    const uniq = [...new Set(plans.map(x => x.trim()))];
    if (!uniq.length) return { ok: false, error: "Allow at least one plan." };
    row.allowed_plans = uniq;
  }

  const money: [keyof PartnerInput, string, number][] = [
    ["setupFeeCents", "setup_fee_cents", defaults.setupFeeCents],
    ["monthlyFeeCents", "monthly_fee_cents", defaults.monthlyFeeCents],
    ["depositCents", "deposit_cents", defaults.depositCents],
  ];
  for (const [k, col, def] of money) {
    const v = p[k] ?? (isNew ? def : undefined);
    if (v === undefined) continue;
    if (!isCents(v)) return { ok: false, error: "Prices must be whole amounts of zero or more." };
    row[col] = v;
  }

  if (kind === "reseller") {
    const pct = p.wholesalePct ?? (isNew ? defaults.wholesalePct : undefined);
    if (pct !== undefined) {
      if (typeof pct !== "number" || !(pct > 0 && pct <= 100)) return { ok: false, error: "The wholesale share must be between 1% and 100% of list price." };
      row.wholesale_pct = pct;
    }
  } else if (isNew) row.wholesale_pct = null;

  if (p.graceDays !== undefined) {
    if (!Number.isInteger(p.graceDays) || p.graceDays < 0 || p.graceDays > 60) return { ok: false, error: "Grace days must be between 0 and 60." };
    row.grace_days = p.graceDays;
  }
  if (p.brand !== undefined) {
    if (!p.brand || typeof p.brand !== "object") return { ok: false, error: "Brand settings must be an object." };
    const b = checkBrandSettings(p.brand);
    if (!b.ok) return { ok: false, error: b.error };
    row.brand = b.brand;
  }
  return { ok: true, row };
}

/**
 * Whether a workspace may be linked to a partner. Pure; the database write
 * repeats the ownership condition so two owners racing can't both win.
 */
export function checkAssignment(partner: Pick<Partner, "id" | "status" | "allowedPlans">, tenant: { id: string; plan: string; partnerId: string | null }): string | null {
  if (tenant.id === DEFAULT_TENANT_ID) return "The platform's own workspace can't belong to a partner.";
  if (partner.status === "closed") return "This partner is closed. Reopen it before adding workspaces.";
  if (tenant.partnerId && tenant.partnerId !== partner.id) return "This workspace already belongs to another partner. Remove it there first.";
  if (!partner.allowedPlans.includes(tenant.plan)) {
    return `This workspace is on the ${tenant.plan} plan, which this partner can't use. Allowed: ${partner.allowedPlans.join(", ")}.`;
  }
  return null;
}

/** The migration hasn't been applied: the partner tables or column are missing. */
export function isPartnerSchemaMissing(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code ?? "";
  const msg = errorMessage(err);
  return ["42P01", "42703", "PGRST205", "PGRST204"].includes(code)
    || (/wa_partners|wa_partner_audit|partner_id/.test(msg) && /does not exist|could not find|schema cache/i.test(msg));
}
export const PARTNER_SCHEMA_HINT = "Partners aren't set up in the database yet. Apply migration 20261030120000_white_label_partners.sql in Supabase, then reload.";

function mapPartner(r: Record<string, unknown>): Partner {
  return {
    id: r.id as string, name: r.name as string, slug: r.slug as string,
    kind: r.kind as PartnerKind, tier: r.tier as PartnerTier, status: r.status as PartnerStatus,
    contactName: (r.contact_name as string | null) ?? null, contactEmail: (r.contact_email as string | null) ?? null,
    contactPhone: (r.contact_phone as string | null) ?? null,
    allowedPlans: (r.allowed_plans as string[] | null) ?? [],
    setupFeeCents: Number(r.setup_fee_cents ?? 0), monthlyFeeCents: Number(r.monthly_fee_cents ?? 0),
    depositCents: Number(r.deposit_cents ?? 0),
    wholesalePct: r.wholesale_pct == null ? null : Number(r.wholesale_pct),
    graceDays: Number(r.grace_days ?? 7), notes: (r.notes as string | null) ?? null,
    createdAt: r.created_at as string, updatedAt: r.updated_at as string,
    brand: (r.brand as BrandSettings | null) ?? {},
    resalePrices: (r.resale_prices as Record<string, number> | null) ?? {},
    balanceCents: Number(r.balance_cents ?? 0), billingDay: Number(r.billing_day ?? 1),
    billingState: ((r.billing_state as string) ?? "ok") as Partner["billingState"],
    graceUntil: (r.grace_until as string | null) ?? null, setupPaidAt: (r.setup_paid_at as string | null) ?? null,
    razorpay: {
      keyId: ((r.razorpay as { keyId?: string } | null)?.keyId) ?? null,
      connected: !!((r.razorpay as { secretEnc?: string } | null)?.secretEnc),
    },
    customerBilling: { ...CUSTOMER_BILLING_DEFAULTS, ...((r.customer_billing as Partial<CustomerBilling> | null) ?? {}) },
  };
}

function mapWorkspace(r: Record<string, unknown>): PartnerWorkspace {
  return {
    id: r.id as string, name: r.name as string, company: (r.company as string | null) ?? null,
    plan: r.plan as string, status: r.status as string,
    paymentStatus: (r.payment_status as string | null) ?? null, createdAt: r.created_at as string,
  };
}

const WORKSPACE_COLS = "id,name,company,plan,status,payment_status,created_at";

export async function listPartners(): Promise<(Partner & { workspaceCount: number })[]> {
  const { data, error } = await db().from("wa_partners").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  const partners = (data ?? []).map(r => mapPartner(r as Record<string, unknown>));
  // One exact count per partner: a select of every linked row would be capped
  // at PostgREST's 1,000-row limit once partners grow.
  const counts = await Promise.all(partners.map(p =>
    db().from("tenants").select("id", { count: "exact", head: true }).eq("partner_id", p.id).then(r => r.count ?? 0)));
  return partners.map((p, i) => ({ ...p, workspaceCount: counts[i] }));
}

export async function getPartner(id: string): Promise<Partner | null> {
  const { data, error } = await db().from("wa_partners").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? mapPartner(data as Record<string, unknown>) : null;
}

export async function createPartner(input: PartnerInput, actor: string): Promise<{ partner?: Partner; error?: string }> {
  const c = checkPartnerInput(input);
  if (!c.ok) return { error: c.error };
  const { data, error } = await db().from("wa_partners").insert(c.row).select().single();
  if (error) {
    if (error.code === "23505") return { error: `The address "${c.row.slug}" is taken. Choose another.` };
    throw error;
  }
  const partner = mapPartner(data as Record<string, unknown>);
  await partnerAudit(partner.id, actor, "partner.created", null, `${partner.kind} · ${partner.tier}`);
  return { partner };
}

export async function updatePartner(id: string, input: PartnerInput, actor: string): Promise<{ partner?: Partner; error?: string }> {
  const existing = await getPartner(id);
  if (!existing) return { error: "Partner not found." };
  const c = checkPartnerInput(input, existing);
  if (!c.ok) return { error: c.error };
  if (!Object.keys(c.row).length) return { partner: existing };
  const { data, error } = await db().from("wa_partners").update({ ...c.row, updated_at: new Date().toISOString() }).eq("id", id).select().single();
  if (error) {
    if (error.code === "23505") return { error: `The address "${c.row.slug}" is taken. Choose another.` };
    throw error;
  }
  await partnerAudit(id, actor, "partner.updated", null, Object.keys(c.row).join(", "));
  return { partner: mapPartner(data as Record<string, unknown>) };
}

export async function setPartnerStatus(id: string, status: PartnerStatus, actor: string): Promise<{ partner?: Partner; error?: string }> {
  if (!PARTNER_STATUSES.includes(status)) return { error: "Unknown status." };
  const existing = await getPartner(id);
  if (!existing) return { error: "Partner not found." };
  if (existing.status === status) return { partner: existing };
  if (status === "closed") {
    const { count } = await db().from("tenants").select("id", { count: "exact", head: true }).eq("partner_id", id);
    if (count) return { error: `This partner still has ${count} workspace${count === 1 ? "" : "s"}. Remove or move them before closing.` };
  }
  const { data, error } = await db().from("wa_partners").update({ status, updated_at: new Date().toISOString() }).eq("id", id).select().single();
  if (error) throw error;
  // Pausing a partner pauses all its customers' workspaces (cause 'talko');
  // un-pausing lifts exactly those, never a pause the partner or its balance put on.
  let detail = `${existing.status} → ${status}`;
  try {
    const billing = await import("./partner-billing");
    if (status === "paused") detail += ` · ${await billing.pausePartnerWorkspaces(id, "talko")} workspaces paused`;
    else if (existing.status === "paused") detail += ` · ${await billing.resumePartnerWorkspaces(id, "talko")} workspaces resumed`;
  } catch (e) { detail += ` · workspaces unchanged (${errorMessage(e)})`; }
  await partnerAudit(id, actor, "partner.status", null, detail);
  return { partner: mapPartner(data as Record<string, unknown>) };
}

/** The workspaces one partner owns. Filtered by partner_id in the database, never in code. */
export async function partnerWorkspaces(partnerId: string): Promise<PartnerWorkspace[]> {
  const { data, error } = await db().from("tenants").select(WORKSPACE_COLS)
    .eq("partner_id", partnerId).order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(r => mapWorkspace(r as Record<string, unknown>));
}

/** One workspace, only if it belongs to this partner; otherwise null, never another partner's. */
export async function getPartnerWorkspace(partnerId: string, tenantId: string): Promise<PartnerWorkspace | null> {
  const { data, error } = await db().from("tenants").select(WORKSPACE_COLS)
    .eq("id", tenantId).eq("partner_id", partnerId).maybeSingle();
  if (error) throw error;
  return data ? mapWorkspace(data as Record<string, unknown>) : null;
}

export async function assignWorkspace(partnerId: string, tenantId: string, actor: string): Promise<{ ok?: true; error?: string }> {
  if (tenantId === DEFAULT_TENANT_ID) return { error: "The platform's own workspace can't belong to a partner." };
  const partner = await getPartner(partnerId);
  if (!partner) return { error: "Partner not found." };
  const { data: t, error } = await db().from("tenants").select("id,plan,partner_id").eq("id", tenantId).maybeSingle();
  if (error) throw error;
  if (!t) return { error: "Workspace not found." };
  const tenant = { id: t.id as string, plan: t.plan as string, partnerId: (t.partner_id as string | null) ?? null };
  if (tenant.partnerId === partnerId) return { ok: true };
  const refusal = checkAssignment(partner, tenant);
  if (refusal) return { error: refusal };
  // Only claims a workspace that is still partner-less at write time.
  const { data: claimed, error: upErr } = await db().from("tenants").update({ partner_id: partnerId })
    .eq("id", tenantId).is("partner_id", null).select("id");
  if (upErr) throw upErr;
  if (!claimed?.length) return { error: "This workspace was just added to another partner. Reload and check." };
  await partnerAudit(partnerId, actor, "workspace.added", tenantId, tenant.plan);
  return { ok: true };
}

export async function removeWorkspace(partnerId: string, tenantId: string, actor: string): Promise<{ ok?: true; error?: string }> {
  const { data, error } = await db().from("tenants").update({ partner_id: null })
    .eq("id", tenantId).eq("partner_id", partnerId).select("id");
  if (error) throw error;
  if (!data?.length) return { error: "That workspace doesn't belong to this partner." };
  await partnerAudit(partnerId, actor, "workspace.removed", tenantId);
  return { ok: true };
}

export async function partnerAudit(partnerId: string, actor: string, action: string, tenantId: string | null, detail = ""): Promise<void> {
  try { await db().from("wa_partner_audit").insert({ partner_id: partnerId, actor, action, tenant_id: tenantId, detail }); }
  catch { /* the audit is best-effort; the change itself already happened */ }
}

export async function listPartnerAudit(partnerId: string, limit = 50): Promise<{ actor: string; action: string; tenantId: string | null; detail: string; at: string }[]> {
  const { data } = await db().from("wa_partner_audit").select("*").eq("partner_id", partnerId)
    .order("created_at", { ascending: false }).limit(limit);
  return (data ?? []).map(r => ({
    actor: r.actor as string, action: r.action as string, tenantId: (r.tenant_id as string | null) ?? null,
    detail: (r.detail as string) ?? "", at: r.created_at as string,
  }));
}
