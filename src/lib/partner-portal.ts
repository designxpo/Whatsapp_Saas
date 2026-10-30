// White-label, Phase 3: everything a partner does from its own dashboard at
// `<slug>.<base>/partner` — its staff accounts, its customers' workspaces, its
// prices — without Talko in the loop.
//
// The rules that keep partners inside their own fence:
//   - A session is honoured only on the partner's own address, only while the
//     account is active and its token_version matches, and only while the
//     partner isn't closed (currentPartner, checked on every request).
//   - Every workspace action goes through a partner_id-filtered query
//     (partners.ts), so a partner can't name another partner's workspace.
//   - Only plans the owner allowed can be used, and a reseller's price can
//     never go below Talko's list price.
//
// Schema: supabase/migrations/20261030160000_partner_dashboard.sql.

import { createHash, randomBytes } from "crypto";
import { cookies, headers } from "next/headers";
import { db } from "./supabase";
import { PARTNER_SESSION_COOKIE, verifyPartnerSessionToken } from "./auth";
import { hashPassword, verifyPassword } from "./team";
import { getPartner, partnerAudit, getPartnerWorkspace, type Partner } from "./partners";
import { listPlans, type Plan } from "./plans";
import { getEntitlements } from "./entitlements";
import { renderEmail } from "./emailtemplate";
import { sendEmail } from "./email";
import { brandFromPartner, partnerOrigin, partnerSlugFromHost, whiteLabelConfig, type Brand } from "./whitelabel";

export type PartnerRole = "owner" | "staff";
export interface PartnerUser {
  id: string; partnerId: string; email: string; name: string; role: PartnerRole;
  active: boolean; hasPassword: boolean; invitePending: boolean; lastLoginAt: string | null; createdAt: string;
}
export interface PartnerContext { user: PartnerUser; tokenVersion: number; partner: Partner; brand: Brand }

export const MIN_PASSWORD = 10;
const INVITE_DAYS = 7;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const sha = (t: string) => createHash("sha256").update(t).digest("hex");

function mapUser(r: Record<string, unknown>): PartnerUser {
  return {
    id: r.id as string, partnerId: r.partner_id as string, email: r.email as string, name: (r.name as string) ?? "",
    role: (r.role as PartnerRole) ?? "staff", active: r.active !== false, hasPassword: !!r.password_hash,
    invitePending: !r.password_hash && !!r.setup_token_hash,
    lastLoginAt: (r.last_login_at as string | null) ?? null, createdAt: r.created_at as string,
  };
}

// ── Pure rules ──────────────────────────────────────────────────────────────

/** A reseller's prices: only plans it may sell, each at or above Talko's list price. */
export function checkResalePrices(
  input: unknown, plans: Pick<Plan, "key" | "name" | "priceCents">[], allowed: string[],
): { ok: true; prices: Record<string, number> } | { ok: false; error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "Prices must be a list of plan prices." };
  const prices: Record<string, number> = {};
  for (const [key, v] of Object.entries(input as Record<string, unknown>)) {
    const plan = plans.find(p => p.key === key);
    if (!plan || !allowed.includes(key)) return { ok: false, error: `You can't sell the "${key}" plan.` };
    if (typeof v !== "number" || !Number.isInteger(v)) return { ok: false, error: `Enter a whole amount for ${plan.name}.` };
    if (v < plan.priceCents) return { ok: false, error: `${plan.name} can't be sold below ₹${(plan.priceCents / 100).toLocaleString("en-IN")} a month.` };
    if (v > plan.priceCents * 20) return { ok: false, error: `${plan.name}'s price looks wrong.` };
    prices[key] = v;
  }
  return { ok: true, prices };
}

/** Wholesale share of list price after the volume reward (Business Plan): 45% from 26 workspaces, 40% above 100. */
export function wholesaleShare(pct: number, activeCount: number): number {
  return activeCount > 100 ? Math.min(pct, 40) : activeCount > 25 ? Math.min(pct, 45) : pct;
}

const LIVE = (status: string) => status !== "suspended" && status !== "cancelled";

/**
 * What the partner will owe Talko for a month at today's workspaces. An
 * estimate shown in the dashboard; Phase 4 bills from the same rule.
 * Private Label pays each workspace's plan price plus its brand fee; a
 * reseller pays its platform fee plus a share of list price per live workspace.
 */
export function monthlyEstimate(
  partner: Pick<Partner, "kind" | "monthlyFeeCents" | "wholesalePct">,
  workspaces: { plan: string; status: string }[],
  plans: Pick<Plan, "key" | "priceCents">[],
): { feeCents: number; workspacesCents: number; totalCents: number; live: number; sharePct: number | null } {
  const live = workspaces.filter(w => LIVE(w.status));
  const list = (key: string) => plans.find(p => p.key === key)?.priceCents ?? 0;
  if (partner.kind === "private") {
    const workspacesCents = live.reduce((s, w) => s + list(w.plan), 0);
    return { feeCents: partner.monthlyFeeCents, workspacesCents, totalCents: partner.monthlyFeeCents + workspacesCents, live: live.length, sharePct: null };
  }
  const share = wholesaleShare(partner.wholesalePct ?? 50, live.length);
  const workspacesCents = live.reduce((s, w) => s + Math.round(list(w.plan) * share / 100), 0);
  return { feeCents: partner.monthlyFeeCents, workspacesCents, totalCents: partner.monthlyFeeCents + workspacesCents, live: live.length, sharePct: share };
}

export function checkNewWorkspace(
  input: { company?: unknown; ownerName?: unknown; ownerEmail?: unknown; ownerPhone?: unknown; plan?: unknown },
  allowedPlans: string[],
): { ok: true; v: { company: string; ownerName: string; ownerEmail: string; ownerPhone: string | null; plan: string } } | { ok: false; error: string } {
  const s = (x: unknown, max: number) => (typeof x === "string" ? x.trim().slice(0, max) : "");
  const company = s(input.company, 80), ownerName = s(input.ownerName, 80), ownerEmail = s(input.ownerEmail, 200).toLowerCase();
  const plan = s(input.plan, 40), ownerPhone = s(input.ownerPhone, 30) || null;
  if (company.length < 2) return { ok: false, error: "Enter the customer's business name." };
  if (ownerName.length < 2) return { ok: false, error: "Enter the name of the person who will run the workspace." };
  if (!EMAIL_RE.test(ownerEmail)) return { ok: false, error: "Enter a valid email for that person." };
  if (!allowedPlans.includes(plan)) return { ok: false, error: "Choose one of your plans." };
  return { ok: true, v: { company, ownerName, ownerEmail, ownerPhone, plan } };
}

// ── Session ─────────────────────────────────────────────────────────────────

/** The signed-in partner staff member for this request, or null. */
export async function currentPartner(): Promise<PartnerContext | null> {
  const cfg = whiteLabelConfig();
  if (!cfg.enabled) return null;
  const claims = await verifyPartnerSessionToken((await cookies()).get(PARTNER_SESSION_COOKIE)?.value);
  if (!claims) return null;
  const slug = partnerSlugFromHost((await headers()).get("host"), cfg);
  if (!slug) return null;
  try {
    const { data: u } = await db().from("wa_partner_users").select("*").eq("id", claims.userId).maybeSingle();
    if (!u || u.active === false || u.partner_id !== claims.partnerId || (u.token_version ?? 0) !== claims.tokenVersion) return null;
    const partner = await getPartner(claims.partnerId);
    if (!partner || partner.status === "closed" || partner.slug !== slug) return null;
    return { user: mapUser(u as Record<string, unknown>), tokenVersion: claims.tokenVersion, partner, brand: brandFromPartner(partner) };
  } catch { return null; }
}

/** Email + password for one partner's dashboard. Null on any mismatch. */
export async function verifyPartnerLogin(slug: string, email: string, password: string): Promise<{ user: PartnerUser; tokenVersion: number } | null> {
  const { data: p } = await db().from("wa_partners").select("id,status").eq("slug", slug).maybeSingle();
  if (!p || p.status === "closed") return null;
  const { data: u } = await db().from("wa_partner_users").select("*")
    .eq("partner_id", p.id).ilike("email", email.trim()).maybeSingle();
  if (!u || u.active === false || !u.password_hash || !verifyPassword(password, u.password_hash as string)) return null;
  await db().from("wa_partner_users").update({ last_login_at: new Date().toISOString() }).eq("id", u.id);
  return { user: mapUser(u as Record<string, unknown>), tokenVersion: (u.token_version as number) ?? 0 };
}

// ── Staff accounts ──────────────────────────────────────────────────────────

export async function listPartnerUsers(partnerId: string): Promise<PartnerUser[]> {
  const { data, error } = await db().from("wa_partner_users").select("*").eq("partner_id", partnerId).order("created_at");
  if (error) throw error;
  return (data ?? []).map(r => mapUser(r as Record<string, unknown>));
}

export async function invitePartnerUser(
  partner: Partner, input: { email?: string; name?: string; role?: string }, actor: string,
): Promise<{ user?: PartnerUser; error?: string }> {
  const email = (input.email ?? "").trim().toLowerCase();
  const name = (input.name ?? "").trim().slice(0, 80);
  const role: PartnerRole = input.role === "owner" ? "owner" : "staff";
  if (!EMAIL_RE.test(email)) return { error: "Enter a valid email address." };
  const token = randomBytes(32).toString("base64url");
  const { data, error } = await db().from("wa_partner_users").insert({
    partner_id: partner.id, email, name, role,
    setup_token_hash: sha(token), setup_expires_at: new Date(Date.now() + INVITE_DAYS * 86_400_000).toISOString(),
  }).select().single();
  if (error) {
    if (error.code === "23505") return { error: "That email already has a partner dashboard account." };
    throw error;
  }
  const user = mapUser(data as Record<string, unknown>);
  await sendStaffInvite(partner, user, token);
  await partnerAudit(partner.id, actor, "staff.invited", null, `${email} · ${role}`);
  return { user };
}

/** A fresh invite link for someone who hasn't set a password yet. */
export async function resendPartnerInvite(partner: Partner, userId: string, actor: string): Promise<{ ok?: true; error?: string }> {
  const { data: u } = await db().from("wa_partner_users").select("*").eq("id", userId).eq("partner_id", partner.id).maybeSingle();
  if (!u) return { error: "That account isn't part of this partner." };
  if (u.password_hash) return { error: "This person has already set a password." };
  const token = randomBytes(32).toString("base64url");
  await db().from("wa_partner_users").update({ setup_token_hash: sha(token), setup_expires_at: new Date(Date.now() + INVITE_DAYS * 86_400_000).toISOString() })
    .eq("id", userId).eq("partner_id", partner.id);
  await sendStaffInvite(partner, mapUser(u as Record<string, unknown>), token);
  await partnerAudit(partner.id, actor, "staff.reinvited", null, u.email as string);
  return { ok: true };
}

/** Accept an invitation on `slug`'s address: checked before anything is written. */
export async function acceptPartnerInvite(token: string, password: string, slug: string): Promise<{ user?: PartnerUser; tokenVersion?: number; partnerId?: string; error?: string }> {
  if (password.length < MIN_PASSWORD) return { error: `Use at least ${MIN_PASSWORD} characters.` };
  if (!token) return { error: "This link isn't valid." };
  const { data: u } = await db().from("wa_partner_users").select("*").eq("setup_token_hash", sha(token)).maybeSingle();
  if (!u || u.active === false) return { error: "This link isn't valid. Ask for a new invitation." };
  if (!u.setup_expires_at || Date.parse(u.setup_expires_at as string) < Date.now()) return { error: "This link has expired. Ask for a new invitation." };
  const partner = await getPartner(u.partner_id as string);
  if (!partner || partner.slug !== slug || partner.status === "closed") return { error: "This invitation is for a different address." };
  const version = ((u.token_version as number) ?? 0) + 1;
  const { error } = await db().from("wa_partner_users").update({
    password_hash: hashPassword(password), setup_token_hash: null, setup_expires_at: null,
    token_version: version, last_login_at: new Date().toISOString(),
  }).eq("id", u.id);
  if (error) throw error;
  await partnerAudit(u.partner_id as string, u.email as string, "staff.joined", null);
  return { user: mapUser({ ...u, password_hash: "set", setup_token_hash: null }), tokenVersion: version, partnerId: u.partner_id as string };
}

export async function removePartnerUser(partnerId: string, userId: string, actor: string): Promise<{ ok?: true; error?: string }> {
  const users = await listPartnerUsers(partnerId);
  const target = users.find(u => u.id === userId);
  if (!target) return { error: "That account isn't part of this partner." };
  if (target.role === "owner" && users.filter(u => u.role === "owner" && u.active).length <= 1) {
    return { error: "This is the last owner. Make someone else an owner first." };
  }
  const { error } = await db().from("wa_partner_users").delete().eq("id", userId).eq("partner_id", partnerId);
  if (error) throw error;
  await partnerAudit(partnerId, actor, "staff.removed", null, target.email);
  return { ok: true };
}

// ── Customer workspaces ─────────────────────────────────────────────────────

export async function createPartnerWorkspace(partner: Partner, input: Parameters<typeof checkNewWorkspace>[0], actor: string): Promise<{ tenantId?: string; error?: string }> {
  if (partner.status !== "active" && partner.status !== "onboarding") return { error: "This partner account is paused. Contact Talko." };
  const c = checkNewWorkspace(input, partner.allowedPlans);
  if (!c.ok) return { error: c.error };
  const v = c.v;
  // Prepaid (Phase 4): the setup fee is paid, and the balance covers this
  // workspace for the rest of the billing period, before anything is created.
  const billing = await import("./partner-billing");
  if (partner.setupFeeCents > 0 && !partner.setupPaidAt) return { error: "Add money to pay your setup fee first (Billing tab)." };
  if (partner.billingState === "suspended") return { error: "Your balance is short and your workspaces are paused. Add money first (Billing tab)." };
  const pre = await billing.chargeWorkspaceStart(partner, { tenantId: "check", plan: v.plan, actor, check: true });
  if (!pre.ok) return { error: pre.error };
  const { data: taken } = await db().from("wa_users").select("id").ilike("email", v.ownerEmail).maybeSingle();
  if (taken) return { error: "That email already has an account. Use a different email for this customer." };

  const base = v.company.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "workspace";
  let slug = base;
  for (let i = 0; i < 5; i++) {
    const { data: clash } = await db().from("tenants").select("id").eq("slug", slug).maybeSingle();
    if (!clash) break;
    slug = `${base}-${randomBytes(2).toString("hex")}`;
  }
  // A partner's workspace is paid through the partner, so it starts active on
  // its plan: no Talko trial, no Talko checkout.
  const { data: t, error } = await db().from("tenants").insert({
    name: v.company, slug, status: "active", plan: v.plan, payment_status: "active",
    company: v.company, owner_name: v.ownerName, owner_email: v.ownerEmail, owner_phone: v.ownerPhone,
    source: "partner", features: {}, partner_id: partner.id,
  }).select("id").single();
  if (error) throw error;
  const tenantId = t!.id as string;
  // No password: the owner sets one through the sign-in page's reset step,
  // which the welcome email opens directly.
  const { error: uErr } = await db().from("wa_users").insert({
    email: v.ownerEmail, name: v.ownerName, password_hash: hashPassword(randomBytes(24).toString("base64url")), role: "admin", tenant_id: tenantId,
  });
  if (uErr) {
    await db().from("tenants").delete().eq("id", tenantId).eq("partner_id", partner.id);
    throw uErr;
  }
  const charged = await billing.chargeWorkspaceStart(partner, { tenantId, plan: v.plan, actor });
  if (!charged.ok) {
    // The balance changed between the check and the charge: undo, charge nothing.
    await db().from("wa_users").delete().eq("tenant_id", tenantId);
    await db().from("tenants").delete().eq("id", tenantId).eq("partner_id", partner.id);
    return { error: charged.error };
  }
  await sendWorkspaceWelcome(partner, v.ownerEmail, v.ownerName, v.company);
  await partnerAudit(partner.id, actor, "workspace.created", tenantId, `${v.company} · ${v.plan}${charged.amountCents ? ` · ₹${charged.amountCents / 100} for the rest of the month` : ""}`);
  return { tenantId };
}

export async function setPartnerWorkspacePlan(partner: Partner, tenantId: string, plan: string, actor: string): Promise<{ ok?: true; error?: string }> {
  if (!partner.allowedPlans.includes(plan)) return { error: "Choose one of your plans." };
  const ws = await getPartnerWorkspace(partner.id, tenantId);
  if (!ws) return { error: "That workspace isn't one of yours." };
  if (ws.plan === plan) return { ok: true };
  // Moving up mid-period pays the difference for the rest of it (prepaid).
  // Moving down takes effect from the next bill; nothing is refunded.
  const up = await (await import("./partner-billing")).chargeWorkspaceStart(partner, { tenantId, plan, fromPlan: ws.plan, actor });
  if (!up.ok) return { error: up.error };
  const { error } = await db().from("tenants").update({ plan }).eq("id", tenantId).eq("partner_id", partner.id);
  if (error) throw error;
  await partnerAudit(partner.id, actor, "workspace.plan", tenantId, `${ws.plan} → ${plan}`);
  return { ok: true };
}

/** Pause stops sending and automation in that workspace (the portal tells its users to contact the partner); resume restores it. */
export async function setPartnerWorkspacePaused(partner: Partner, tenantId: string, paused: boolean, actor: string): Promise<{ ok?: true; error?: string }> {
  const ws = await getPartnerWorkspace(partner.id, tenantId);
  if (!ws) return { error: "That workspace isn't one of yours." };
  const status = paused ? "suspended" : "active";
  if (ws.status === status) return { ok: true };
  // A pause records its cause, and a partner can lift only its own (or an
  // unpaid-customer one): never a pause for its own balance or one by Talko.
  const { data: cur } = await db().from("tenants").select("partner_pause").eq("id", tenantId).eq("partner_id", partner.id).maybeSingle();
  const cause = (cur as { partner_pause?: string | null } | null)?.partner_pause ?? null;
  if (!paused && cause === "billing") return { error: "This workspace is paused because your balance is short. Add money and it resumes." };
  if (!paused && cause === "talko") return { error: "Talko paused your partner account. Contact Talko." };
  const { error } = await db().from("tenants").update({ status, partner_pause: paused ? "partner" : null }).eq("id", tenantId).eq("partner_id", partner.id);
  if (error) throw error;
  await partnerAudit(partner.id, actor, paused ? "workspace.paused" : "workspace.resumed", tenantId);
  return { ok: true };
}

export async function partnerWorkspaceUsage(partner: Partner, tenantId: string) {
  const ws = await getPartnerWorkspace(partner.id, tenantId);
  if (!ws) return null;
  const ent = await getEntitlements(tenantId, { withUsage: true });
  return { workspace: ws, limits: ent.limits, usage: ent.usage ?? null };
}

export async function setResalePrices(partner: Partner, input: unknown, actor: string): Promise<{ prices?: Record<string, number>; error?: string }> {
  if (partner.kind !== "reseller") return { error: "Only resellers set their own prices." };
  const c = checkResalePrices(input, await listPlans(), partner.allowedPlans);
  if (!c.ok) return { error: c.error };
  const { error } = await db().from("wa_partners").update({ resale_prices: c.prices, updated_at: new Date().toISOString() }).eq("id", partner.id);
  if (error) throw error;
  await partnerAudit(partner.id, actor, "prices.updated", null, Object.entries(c.prices).map(([k, v]) => `${k} ₹${v / 100}`).join(", "));
  return { prices: c.prices };
}

// ── Emails ──────────────────────────────────────────────────────────────────

function origin(partner: Partner): string { return partnerOrigin(partner.slug, whiteLabelConfig()); }

async function sendStaffInvite(partner: Partner, user: PartnerUser, token: string) {
  const brand = brandFromPartner(partner);
  const { html, text } = renderEmail({
    brand: { name: brand.name, logoUrl: brand.logoUrl },
    preheader: `Set your password to manage ${brand.name}'s customers.`,
    heading: `Your ${brand.name} partner dashboard`,
    paragraphs: [
      `${user.name ? `Hi ${user.name}, you` : "You"} now have access to the partner dashboard, where you add and manage your customers' workspaces.`,
      `Choose a password with the button below. The link works once, for ${INVITE_DAYS} days.`,
    ],
    cta: { label: "Set your password", href: `/partner/setup?token=${encodeURIComponent(token)}` },
    footerReason: `You're getting this because you were invited to the ${brand.name} partner dashboard.`,
  }, origin(partner));
  await sendEmail({ to: user.email, subject: `Set up your ${brand.name} partner dashboard`, html, text, type: "other", fromName: brand.name })
    .catch(e => console.error("[partner] invite email failed", e));
}

async function sendWorkspaceWelcome(partner: Partner, email: string, name: string, company: string) {
  const brand = brandFromPartner(partner);
  const { html, text } = renderEmail({
    brand: { name: brand.name, logoUrl: brand.logoUrl },
    preheader: `Your ${company} workspace is ready. Set your password to sign in.`,
    heading: `Your ${company} workspace is ready`,
    paragraphs: [
      `Hi ${name}, ${brand.name} has set up a workspace for ${company}.`,
      "Open the link below and choose a password. We'll email you a short code to confirm it's you.",
    ],
    cta: { label: "Set your password", href: `/login?setup=${encodeURIComponent(email)}` },
    footerReason: `You're getting this because ${brand.name} created a workspace for you.`,
  }, origin(partner));
  await sendEmail({ to: email, subject: `Your ${company} workspace is ready`, html, text, type: "other", fromName: brand.name })
    .catch(e => console.error("[partner] welcome email failed", e));
}
