// Product-owner tenant management. Unlike everything else, this is NOT tenant-
// scoped — the platform owner sees and controls ALL tenants. Uses the service
// client directly. Guard every caller with requirePlatformOwner().

import { db } from "./supabase";
import { hashPassword } from "./team";

export type PaymentStatus = "trialing" | "active" | "past_due" | "cancelled" | "none";
export type TenantStatus = "active" | "trialing" | "suspended" | "cancelled";
export interface TenantFeatures { whatsapp: boolean; instagram: boolean; sequences: boolean; commerce: boolean; growth: boolean; ai_autoreply: boolean; ads: boolean }

export interface Tenant {
  id: string; name: string; slug: string; status: TenantStatus; plan: string;
  company: string | null; ownerName: string | null; ownerEmail: string | null; ownerPhone: string | null;
  industry: string | null; teamSize: string | null; useCase: string | null; expectedVolume: string | null; source: string | null;
  paymentStatus: PaymentStatus; trialEndsAt: string | null; currentPeriodEnd: string | null;
  amountCents: number; currency: string; notes: string | null;
  features: TenantFeatures; onboarded: boolean; createdAt: string;
}

const DEFAULT_FEATURES: TenantFeatures = { whatsapp: true, instagram: true, sequences: true, commerce: true, growth: true, ai_autoreply: true, ads: true };

function mapTenant(r: Record<string, unknown>): Tenant {
  return {
    id: r.id as string, name: r.name as string, slug: r.slug as string,
    status: (r.status as TenantStatus) ?? "active", plan: (r.plan as string) ?? "trial",
    company: (r.company as string | null) ?? null, ownerName: (r.owner_name as string | null) ?? null,
    ownerEmail: (r.owner_email as string | null) ?? null, ownerPhone: (r.owner_phone as string | null) ?? null,
    industry: (r.industry as string | null) ?? null, teamSize: (r.team_size as string | null) ?? null,
    useCase: (r.use_case as string | null) ?? null, expectedVolume: (r.expected_volume as string | null) ?? null,
    source: (r.source as string | null) ?? null,
    paymentStatus: (r.payment_status as PaymentStatus) ?? "trialing",
    trialEndsAt: (r.trial_ends_at as string | null) ?? null, currentPeriodEnd: (r.current_period_end as string | null) ?? null,
    amountCents: (r.amount_cents as number) ?? 0, currency: (r.currency as string) ?? "INR",
    notes: (r.notes as string | null) ?? null,
    features: { ...DEFAULT_FEATURES, ...((r.features as Partial<TenantFeatures>) ?? {}) },
    onboarded: (r.onboarded as boolean) ?? false, createdAt: r.created_at as string,
  };
}

// All tenants + a couple of usage counts each (small-N friendly).
export async function listTenants(): Promise<(Tenant & { contacts: number; conversations: number })[]> {
  const { data } = await db().from("tenants").select("*").order("created_at", { ascending: false });
  const tenants = (data ?? []).map(r => mapTenant(r as Record<string, unknown>));
  return Promise.all(tenants.map(async t => {
    const [c, cv] = await Promise.all([
      db().from("contacts").select("*", { count: "exact", head: true }).eq("tenant_id", t.id),
      db().from("wa_conversations").select("*", { count: "exact", head: true }).eq("tenant_id", t.id),
    ]);
    return { ...t, contacts: c.count ?? 0, conversations: cv.count ?? 0 };
  }));
}

export async function getTenant(id: string): Promise<Tenant | null> {
  const { data } = await db().from("tenants").select("*").eq("id", id).maybeSingle();
  return data ? mapTenant(data as Record<string, unknown>) : null;
}

export async function updateTenant(id: string, p: Partial<{ status: TenantStatus; plan: string; paymentStatus: PaymentStatus; trialEndsAt: string | null; currentPeriodEnd: string | null; amountCents: number; currency: string; notes: string; features: Partial<TenantFeatures> }>): Promise<void> {
  const row: Record<string, unknown> = {};
  if (p.status !== undefined) row.status = p.status;
  if (p.plan !== undefined) row.plan = p.plan;
  if (p.paymentStatus !== undefined) row.payment_status = p.paymentStatus;
  if (p.trialEndsAt !== undefined) row.trial_ends_at = p.trialEndsAt;
  if (p.currentPeriodEnd !== undefined) row.current_period_end = p.currentPeriodEnd;
  if (p.amountCents !== undefined) row.amount_cents = p.amountCents;
  if (p.currency !== undefined) row.currency = p.currency;
  if (p.notes !== undefined) row.notes = p.notes;
  if (p.features !== undefined) {
    const current = await getTenant(id);
    row.features = { ...DEFAULT_FEATURES, ...(current?.features ?? {}), ...p.features };
  }
  if (Object.keys(row).length) { const { error } = await db().from("tenants").update(row).eq("id", id); if (error) throw error; }
}

// Platform metrics for the owner dashboard.
export async function platformStats(): Promise<{ total: number; active: number; trialing: number; suspended: number; mrrCents: number }> {
  const { data } = await db().from("tenants").select("status, payment_status, amount_cents");
  const rows = (data ?? []) as { status: string; payment_status: string; amount_cents: number }[];
  let active = 0, trialing = 0, suspended = 0, mrrCents = 0;
  for (const r of rows) {
    if (r.status === "suspended" || r.status === "cancelled") suspended++;
    else if (r.status === "trialing" || r.payment_status === "trialing") trialing++;
    else active++;
    if (r.payment_status === "active") mrrCents += r.amount_cents ?? 0;
  }
  return { total: rows.length, active, trialing, suspended, mrrCents };
}

// Self-serve signup → new tenant (14-day trial) + its first admin user.
export async function createTenantFromSignup(p: {
  company: string; ownerName: string; ownerEmail: string; password: string;
  ownerPhone?: string; industry?: string; teamSize?: string; useCase?: string; expectedVolume?: string; source?: string;
}): Promise<{ tenantId: string; email: string }> {
  const email = p.ownerEmail.trim().toLowerCase();
  // Reject if the email already has an account.
  const existing = await db().from("wa_users").select("id").eq("email", email).maybeSingle();
  if (existing.data) throw new Error("An account with this email already exists — try logging in.");

  const base = (p.company || p.ownerName || "team").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "team";
  let slug = base;
  for (let i = 0; i < 5; i++) {
    const clash = await db().from("tenants").select("id").eq("slug", slug).maybeSingle();
    if (!clash.data) break;
    slug = `${base}-${Math.floor(1000 + (Date.parse(new Date().toISOString()) % 9000))}`;
  }
  const trialEnds = new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString();

  const ins = await db().from("tenants").insert({
    name: p.company.trim(), slug, status: "trialing", plan: "trial", payment_status: "trialing",
    company: p.company.trim(), owner_name: p.ownerName.trim(), owner_email: email, owner_phone: p.ownerPhone ?? null,
    industry: p.industry ?? null, team_size: p.teamSize ?? null, use_case: p.useCase ?? null,
    expected_volume: p.expectedVolume ?? null, source: p.source ?? "signup", trial_ends_at: trialEnds,
  }).select("id").single();
  if (ins.error) throw ins.error;
  const tenantId = ins.data!.id as string;

  const u = await db().from("wa_users").insert({
    email, name: p.ownerName.trim(), password_hash: hashPassword(p.password), role: "admin", tenant_id: tenantId,
  }).select("id").single();
  if (u.error) throw u.error;

  return { tenantId, email };
}

// Hard-delete a tenant and everything it owns (FKs cascade from 0019). The
// default tenant can never be deleted.
export async function deleteTenant(id: string): Promise<void> {
  if (id === "00000000-0000-0000-0000-000000000001") throw new Error("The default tenant cannot be deleted");
  await db().from("wa_users").delete().eq("tenant_id", id);   // users aren't tenant-FK-cascaded
  const { error } = await db().from("tenants").delete().eq("id", id);
  if (error) throw error;
}

export async function ownerAudit(actorEmail: string, action: string, tenantId: string | null, detail = ""): Promise<void> {
  try { await db().from("wa_owner_audit").insert({ actor_email: actorEmail, action, tenant_id: tenantId, detail }); }
  catch { /* audit is best-effort */ }
}

export async function listOwnerAudit(limit = 50): Promise<{ actorEmail: string; action: string; tenantId: string | null; detail: string; at: string }[]> {
  const { data } = await db().from("wa_owner_audit").select("*").order("created_at", { ascending: false }).limit(limit);
  return (data ?? []).map(r => ({ actorEmail: r.actor_email as string, action: r.action as string, tenantId: (r.tenant_id as string | null) ?? null, detail: (r.detail as string) ?? "", at: r.created_at as string }));
}
