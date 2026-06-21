// Product-owner tenant management. Unlike everything else, this is NOT tenant-
// scoped — the platform owner sees and controls ALL tenants. Uses the service
// client directly. Guard every caller with requirePlatformOwner().

import { db } from "./supabase";
import { hashPassword } from "./team";

export type PaymentStatus = "trialing" | "active" | "past_due" | "cancelled" | "none";
export type TenantStatus = "active" | "trialing" | "suspended" | "cancelled";
// Per-tenant feature OVERRIDES — a sparse key→bool map layered on top of the
// plan defaults by the entitlement resolver (canonical keys: FEATURE_KEYS).
export type TenantFeatures = Record<string, boolean>;

export interface Tenant {
  id: string; name: string; slug: string; status: TenantStatus; plan: string;
  company: string | null; ownerName: string | null; ownerEmail: string | null; ownerPhone: string | null;
  industry: string | null; teamSize: string | null; useCase: string | null; expectedVolume: string | null; source: string | null;
  paymentStatus: PaymentStatus; trialEndsAt: string | null; currentPeriodEnd: string | null;
  amountCents: number; currency: string; notes: string | null;
  features: TenantFeatures; grandfathered: boolean; onboarded: boolean; createdAt: string;
  stripeCustomerId: string | null; stripeSubscriptionId: string | null;
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
    features: { ...DEFAULT_FEATURES, ...((r.features as TenantFeatures) ?? {}) },
    grandfathered: (r.grandfathered as boolean) ?? false,
    onboarded: (r.onboarded as boolean) ?? false, createdAt: r.created_at as string,
    stripeCustomerId: (r.stripe_customer_id as string | null) ?? null,
    stripeSubscriptionId: (r.stripe_subscription_id as string | null) ?? null,
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

export async function updateTenant(id: string, p: Partial<{ status: TenantStatus; plan: string; paymentStatus: PaymentStatus; trialEndsAt: string | null; currentPeriodEnd: string | null; amountCents: number; currency: string; notes: string; features: Partial<TenantFeatures>; grandfathered: boolean }>): Promise<void> {
  const row: Record<string, unknown> = {};
  if (p.status !== undefined) row.status = p.status;
  if (p.plan !== undefined) row.plan = p.plan;
  if (p.paymentStatus !== undefined) row.payment_status = p.paymentStatus;
  if (p.trialEndsAt !== undefined) row.trial_ends_at = p.trialEndsAt;
  if (p.currentPeriodEnd !== undefined) row.current_period_end = p.currentPeriodEnd;
  if (p.amountCents !== undefined) row.amount_cents = p.amountCents;
  if (p.currency !== undefined) row.currency = p.currency;
  if (p.notes !== undefined) row.notes = p.notes;
  if (p.grandfathered !== undefined) row.grandfathered = p.grandfathered;
  if (p.features !== undefined) {
    // Store the owner's explicit choice as per-tenant overrides (merged over any
    // existing ones). The entitlement resolver layers these on top of plan
    // defaults, so unchecking a box revokes and checking it grants.
    const current = await getTenant(id);
    row.features = { ...(current?.features ?? {}), ...p.features };
  }
  if (Object.keys(row).length) { const { error } = await db().from("tenants").update(row).eq("id", id); if (error) throw error; }
}

// ── Stripe billing sync ───────────────────────────────────────────────────────
// Persist Stripe ids on a tenant (after customer/subscription creation).
export async function setStripeIds(tenantId: string, ids: { customerId?: string; subscriptionId?: string | null }): Promise<void> {
  const row: Record<string, unknown> = {};
  if (ids.customerId !== undefined) row.stripe_customer_id = ids.customerId;
  if (ids.subscriptionId !== undefined) row.stripe_subscription_id = ids.subscriptionId;
  if (Object.keys(row).length) await db().from("tenants").update(row).eq("id", tenantId);
}

export async function getTenantByStripeCustomer(customerId: string): Promise<Tenant | null> {
  const { data } = await db().from("tenants").select("*").eq("stripe_customer_id", customerId).maybeSingle();
  return data ? mapTenant(data as Record<string, unknown>) : null;
}

export async function getTenantByStripeSubscription(subscriptionId: string): Promise<Tenant | null> {
  const { data } = await db().from("tenants").select("*").eq("stripe_subscription_id", subscriptionId).maybeSingle();
  return data ? mapTenant(data as Record<string, unknown>) : null;
}

// Apply a Stripe subscription state to a tenant (called by the webhook). Maps
// Stripe's status → our payment_status, sets plan/price/period from the sub.
export async function applySubscription(tenantId: string, p: {
  plan?: string; paymentStatus: PaymentStatus; amountCents?: number; currency?: string;
  currentPeriodEnd?: string | null; subscriptionId?: string | null; status?: TenantStatus;
}): Promise<void> {
  const row: Record<string, unknown> = { payment_status: p.paymentStatus };
  if (p.plan !== undefined) row.plan = p.plan;
  if (p.amountCents !== undefined) row.amount_cents = p.amountCents;
  if (p.currency !== undefined) row.currency = p.currency;
  if (p.currentPeriodEnd !== undefined) row.current_period_end = p.currentPeriodEnd;
  if (p.subscriptionId !== undefined) row.stripe_subscription_id = p.subscriptionId;
  if (p.status !== undefined) row.status = p.status;
  await db().from("tenants").update(row).eq("id", tenantId);
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

// Richer platform analytics for the owner dashboard (signups trend, plan/status
// mix, MRR, trials ending soon).
export async function platformAnalytics(): Promise<{
  signupsByDay: { date: string; count: number }[];
  planMix: { plan: string; count: number }[];
  statusMix: { status: string; count: number }[];
  mrrCents: number; newThisMonth: number; trialsEndingSoon: number;
}> {
  const { data } = await db().from("tenants").select("plan, status, payment_status, amount_cents, trial_ends_at, created_at");
  const rows = (data ?? []) as { plan: string; status: string; payment_status: string; amount_cents: number; trial_ends_at: string | null; created_at: string }[];

  // 30-day signup series.
  const days = new Map<string, number>();
  const since = new Date(); since.setHours(0, 0, 0, 0); since.setDate(since.getDate() - 29);
  for (let i = 0; i < 30; i++) { const d = new Date(since); d.setDate(since.getDate() + i); days.set(d.toISOString().slice(0, 10), 0); }
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const soon = Date.now() + 7 * 86400000;

  const plan = new Map<string, number>(), status = new Map<string, number>();
  let mrrCents = 0, newThisMonth = 0, trialsEndingSoon = 0;
  for (const r of rows) {
    const day = (r.created_at ?? "").slice(0, 10);
    if (days.has(day)) days.set(day, (days.get(day) ?? 0) + 1);
    if (r.created_at && new Date(r.created_at) >= monthStart) newThisMonth++;
    plan.set(r.plan ?? "trial", (plan.get(r.plan ?? "trial") ?? 0) + 1);
    status.set(r.status ?? "active", (status.get(r.status ?? "active") ?? 0) + 1);
    if (r.payment_status === "active") mrrCents += r.amount_cents ?? 0;
    if ((r.payment_status === "trialing" || r.status === "trialing") && r.trial_ends_at) {
      const t = new Date(r.trial_ends_at).getTime();
      if (t > Date.now() && t <= soon) trialsEndingSoon++;
    }
  }
  return {
    signupsByDay: [...days.entries()].map(([date, count]) => ({ date, count })),
    planMix: [...plan.entries()].map(([plan, count]) => ({ plan, count })).sort((a, b) => b.count - a.count),
    statusMix: [...status.entries()].map(([status, count]) => ({ status, count })),
    mrrCents, newThisMonth, trialsEndingSoon,
  };
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

  const baseRow = {
    name: p.company.trim(), slug, status: "trialing", plan: "trial", payment_status: "trialing",
    company: p.company.trim(), owner_name: p.ownerName.trim(), owner_email: email, owner_phone: p.ownerPhone ?? null,
    industry: p.industry ?? null, team_size: p.teamSize ?? null, use_case: p.useCase ?? null,
    expected_volume: p.expectedVolume ?? null, source: p.source ?? "signup", trial_ends_at: trialEnds,
    // New tenants are plan-driven: empty feature overrides so entitlements
    // resolve from the (trial) plan, not all-features-on.
    features: {},
  };
  // `grandfathered` (migration 0059) defaults to false in the DB. Only set it
  // explicitly when the column exists, so signup keeps working before 0059 is
  // applied (retry once without it on a missing-column error).
  let ins = await db().from("tenants").insert({ ...baseRow, grandfathered: false }).select("id").single();
  if (ins.error && /grandfathered/i.test(ins.error.message ?? "")) {
    ins = await db().from("tenants").insert(baseRow).select("id").single();
  }
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
