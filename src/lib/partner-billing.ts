// White-label, Phase 4: money.
//
// 1. Talko ← partner, PREPAID. A partner adds money to a balance through a
//    Razorpay payment link on Talko's account. Every charge is taken from that
//    balance through partner_ledger_post() (one locked transaction, exactly
//    once per reference), and a charge the AVAILABLE balance can't cover
//    (balance minus the held deposit) is refused, so a partner can never owe
//    Talko money.
//      - Setup fee: taken from the first money added.
//      - Monthly: on the partner's billing day, its monthly fee plus every live
//        workspace (partner-portal.ts monthlyEstimate, the Business Plan rule).
//      - Part month: a workspace added (or upgraded) mid-month pays for the
//        rest of the period before it starts.
//      - Short: grace for the partner's grace days, reminders, then every
//        workspace pauses (cause 'billing'). Adding money charges the month
//        and resumes exactly those workspaces.
// 2. Partner ← its customers, through the partner's OWN Razorpay account:
//    monthly payment links at the partner's price; a paid link marks the
//    workspace paid; optionally unpaid workspaces pause after a grace period
//    (cause 'unpaid'). Talko never touches that money.
//
// Schema: supabase/migrations/20261030180000_partner_billing.sql.

import crypto from "crypto";
import { db } from "./supabase";
import { encryptSecret, readSecret } from "./crypto";
import { getPartner, getPartnerWorkspace, partnerAudit, type Partner, type CustomerBilling, CUSTOMER_BILLING_DEFAULTS } from "./partners";
import { listPartnerUsers, monthlyEstimate, wholesaleShare } from "./partner-portal";
import { listPlans, type Plan } from "./plans";
import { createTalkoPaymentLink, razorpayConfigured } from "./razorpay";
import { renderEmail } from "./emailtemplate";
import { sendEmail } from "./email";
import { brandFromPartner, brandOrigin, whiteLabelConfig } from "./whitelabel";

const DAY = 86_400_000;
const IST = 5.5 * 3_600_000;
export const MIN_TOPUP_CENTS = 1_000_00;

// ── Pure rules ──────────────────────────────────────────────────────────────

/**
 * The billing period `now` falls in for a partner billed on `billingDay`
 * (India time). A partner billed on the 5th is in "2026-10" from 5 Oct to 4 Nov.
 */
export function billingPeriod(now: Date, billingDay: number): { period: string; start: Date; end: Date } {
  const t = new Date(now.getTime() + IST);
  let y = t.getUTCFullYear(), m = t.getUTCMonth();
  if (t.getUTCDate() < billingDay) { m -= 1; if (m < 0) { m = 11; y -= 1; } }
  const start = new Date(Date.UTC(y, m, billingDay) - IST);
  const end = new Date(Date.UTC(m === 11 ? y + 1 : y, (m + 1) % 12, billingDay) - IST);
  return { period: `${y}-${String(m + 1).padStart(2, "0")}`, start, end };
}

/** The share of a monthly price left in the current period, rounded to the paisa. */
export function prorataCents(monthlyCents: number, now: Date, billingDay: number): number {
  const { start, end } = billingPeriod(now, billingDay);
  const left = Math.max(0, Math.min(1, (end.getTime() - now.getTime()) / (end.getTime() - start.getTime())));
  return Math.round(monthlyCents * left);
}

/** What one workspace on `plan` costs the partner per month. */
export function workspaceMonthlyCents(
  partner: Pick<Partner, "kind" | "wholesalePct">, plan: string, plans: Pick<Plan, "key" | "priceCents">[], liveCount: number,
): number {
  const list = plans.find(p => p.key === plan)?.priceCents ?? 0;
  if (partner.kind === "private") return list;
  return Math.round(list * wholesaleShare(partner.wholesalePct ?? 50, liveCount) / 100);
}

/** Calendar month in India time, for customer invoices. */
export function customerPeriod(now: Date): string {
  const t = new Date(now.getTime() + IST);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`;
}

// ── Ledger ──────────────────────────────────────────────────────────────────

interface PostResult { ok: boolean; balanceCents: number; duplicate: boolean; short: boolean }

export async function postLedger(p: {
  partnerId: string; kind: "topup" | "setup" | "monthly" | "prorata" | "adjust" | "refund"; amountCents: number;
  description: string; period?: string | null; ref?: string | null; tenantId?: string | null; actor?: string | null; allowShort?: boolean;
}): Promise<PostResult> {
  const { data, error } = await db().rpc("partner_ledger_post", {
    p_partner: p.partnerId, p_kind: p.kind, p_amount: Math.round(p.amountCents), p_description: p.description,
    p_period: p.period ?? null, p_ref: p.ref ?? null, p_tenant: p.tenantId ?? null, p_actor: p.actor ?? null, p_allow_short: !!p.allowShort,
  });
  if (error) throw error;
  const r = (Array.isArray(data) ? data[0] : data) as { ok: boolean; balance_cents: number; duplicate: boolean; short: boolean };
  return { ok: !!r?.ok, balanceCents: Number(r?.balance_cents ?? 0), duplicate: !!r?.duplicate, short: !!r?.short };
}

export async function listLedger(partnerId: string, limit = 100) {
  const { data, error } = await db().from("wa_partner_ledger").select("kind,amount_cents,balance_after_cents,description,period,tenant_id,created_at")
    .eq("partner_id", partnerId).order("created_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return (data ?? []).map(r => ({
    kind: r.kind as string, amountCents: Number(r.amount_cents), balanceAfterCents: Number(r.balance_after_cents),
    description: r.description as string, period: (r.period as string | null) ?? null, tenantId: (r.tenant_id as string | null) ?? null, at: r.created_at as string,
  }));
}

export function available(p: Pick<Partner, "balanceCents" | "depositCents">): number {
  return p.balanceCents - p.depositCents;
}

// ── Workspace pauses by cause ───────────────────────────────────────────────

export type PauseCause = "partner" | "billing" | "unpaid" | "talko";

/** Pause every live workspace of a partner for one cause. Already-paused ones keep their own cause. */
export async function pausePartnerWorkspaces(partnerId: string, cause: PauseCause): Promise<number> {
  const { data, error } = await db().from("tenants").update({ status: "suspended", partner_pause: cause })
    .eq("partner_id", partnerId).in("status", ["active", "trialing"]).is("partner_pause", null).select("id");
  if (error) throw error;
  return data?.length ?? 0;
}

/** Lift exactly the pauses one cause put on. */
export async function resumePartnerWorkspaces(partnerId: string, cause: PauseCause): Promise<number> {
  const { data, error } = await db().from("tenants").update({ status: "active", partner_pause: null })
    .eq("partner_id", partnerId).eq("partner_pause", cause).select("id");
  if (error) throw error;
  return data?.length ?? 0;
}

// ── Charging ────────────────────────────────────────────────────────────────

async function chargeableWorkspaces(partnerId: string): Promise<{ plan: string; status: string }[]> {
  const { data, error } = await db().from("tenants").select("plan,status,partner_pause").eq("partner_id", partnerId);
  if (error) throw error;
  // Workspaces paused for the partner's balance (or by Talko) come back the
  // moment the month is paid, so they are billed with it.
  return (data ?? []).map(r => ({
    plan: r.plan as string,
    status: r.partner_pause === "billing" || r.partner_pause === "talko" ? "active" : (r.status as string),
  }));
}

/** Charge the current period's monthly bill, once. */
export async function chargePeriod(partner: Partner, now: Date, actor = "billing"): Promise<{ charged: boolean; short: boolean; amountCents: number; period: string }> {
  const { period } = billingPeriod(now, partner.billingDay);
  const [plans, workspaces] = await Promise.all([listPlans(), chargeableWorkspaces(partner.id)]);
  const est = monthlyEstimate(partner, workspaces, plans);
  const r = await postLedger({
    partnerId: partner.id, kind: "monthly", amountCents: -est.totalCents, period, ref: `monthly:${period}`, actor,
    description: `${period}: ${partner.kind === "private" ? "brand fee" : "platform fee"} and ${est.live} workspace${est.live === 1 ? "" : "s"}`,
  });
  return { charged: r.ok, short: r.short, amountCents: est.totalCents, period };
}

/** After money arrives: the setup fee first, then any overdue month, then resume. */
export async function afterFunding(partnerId: string, now = new Date(), actor = "billing"): Promise<void> {
  let p = await getPartner(partnerId);
  if (!p) return;
  if (!p.setupPaidAt) {
    const fee = p.setupFeeCents > 0
      ? await postLedger({ partnerId, kind: "setup", amountCents: -p.setupFeeCents, ref: "setup", description: "One-time setup fee", actor })
      : { ok: true };
    if (fee.ok) {
      await db().from("wa_partners").update({ setup_paid_at: now.toISOString() }).eq("id", partnerId);
      await partnerAudit(partnerId, actor, "billing.setup_paid", null);
    }
    p = await getPartner(partnerId);
    if (!p?.setupPaidAt) return;
  }
  if (p.billingState !== "ok") {
    const c = await chargePeriod(p, now, actor);
    if (c.charged) {
      await db().from("wa_partners").update({ billing_state: "ok", grace_until: null }).eq("id", partnerId);
      const resumed = await resumePartnerWorkspaces(partnerId, "billing");
      await partnerAudit(partnerId, actor, "billing.recovered", null, `${c.period} paid · ${resumed} workspace${resumed === 1 ? "" : "s"} resumed`);
    }
  }
}

/**
 * Charge for a workspace starting (or moving up a plan) mid-period. Returns
 * an error when the available balance can't cover it; nothing is charged then.
 */
export async function chargeWorkspaceStart(
  partner: Partner, p: { tenantId: string; plan: string; fromPlan?: string | null; now?: Date; actor: string; check?: boolean },
): Promise<{ ok: true; amountCents: number } | { ok: false; error: string; amountCents: number }> {
  const now = p.now ?? new Date();
  const plans = await listPlans();
  const live = (await chargeableWorkspaces(partner.id)).filter(w => w.status !== "suspended" && w.status !== "cancelled").length;
  const after = workspaceMonthlyCents(partner, p.plan, plans, live + (p.fromPlan ? 0 : 1));
  const before = p.fromPlan ? workspaceMonthlyCents(partner, p.fromPlan, plans, live) : 0;
  const amount = prorataCents(Math.max(0, after - before), now, partner.billingDay);
  if (amount <= 0) return { ok: true, amountCents: 0 };
  if (p.check) {
    return amount <= available(partner) ? { ok: true, amountCents: amount }
      : { ok: false, amountCents: amount, error: `Add money first: this needs ₹${(amount / 100).toLocaleString("en-IN")} and your available balance is ₹${(Math.max(0, available(partner)) / 100).toLocaleString("en-IN")}.` };
  }
  const { period } = billingPeriod(now, partner.billingDay);
  const r = await postLedger({
    partnerId: partner.id, kind: "prorata", amountCents: -amount, period, tenantId: p.tenantId, actor: p.actor,
    ref: `${p.fromPlan ? "upgrade" : "start"}:${p.tenantId}:${period}:${p.plan}`,
    description: p.fromPlan ? `Upgrade to ${p.plan}, rest of ${period}` : `New workspace on ${p.plan}, rest of ${period}`,
  });
  return r.ok ? { ok: true, amountCents: amount } : { ok: false, amountCents: amount, error: "Add money first: your available balance doesn't cover this." };
}

// ── Adding money ────────────────────────────────────────────────────────────

const origin = (p: Partner) => brandOrigin(brandFromPartner(p), whiteLabelConfig());

export async function createTopup(partner: Partner, amountCents: number, actor: { email: string; name?: string }): Promise<{ url?: string; error?: string }> {
  if (!razorpayConfigured()) return { error: "Online payment isn't switched on yet. Contact Talko to add money by bank transfer." };
  if (!Number.isInteger(amountCents) || amountCents < MIN_TOPUP_CENTS) return { error: `Add at least ₹${(MIN_TOPUP_CENTS / 100).toLocaleString("en-IN")}.` };
  if (amountCents > 50_00_000_00) return { error: "For amounts above ₹50 lakh, contact Talko." };
  const link = await createTalkoPaymentLink({
    amountCents, description: `${partner.name}: add to prepaid balance`,
    notes: { kind: "partner_topup", partner_id: partner.id },
    callbackUrl: `${origin(partner)}/partner?paid=1`,
    customer: { name: actor.name || partner.name, email: actor.email },
  });
  await partnerAudit(partner.id, actor.email, "billing.topup_link", null, `₹${amountCents / 100}`);
  return { url: link.url };
}

/** From the payment_link.paid webhook. Exactly once per payment link. */
export async function creditTopup(p: { partnerId: string; linkId: string; amountCents: number }): Promise<void> {
  if (!(p.amountCents > 0)) return;
  const r = await postLedger({ partnerId: p.partnerId, kind: "topup", amountCents: p.amountCents, ref: `topup:${p.linkId}`, description: "Money added (Razorpay)", actor: "razorpay" });
  if (r.duplicate) return;
  await afterFunding(p.partnerId);
  const partner = await getPartner(p.partnerId);
  if (partner) await notifyOwners(partner, `₹${(p.amountCents / 100).toLocaleString("en-IN")} added to your balance`, "Payment received", [
    `₹${(p.amountCents / 100).toLocaleString("en-IN")} was added to your prepaid balance. Your balance is now ₹${(partner.balanceCents / 100).toLocaleString("en-IN")}.`,
  ]);
}

/** Owner-side credit or debit, e.g. a bank transfer received offline. */
export async function ownerAdjust(partnerId: string, amountCents: number, description: string, actor: string): Promise<{ error?: string }> {
  if (!Number.isInteger(amountCents) || amountCents === 0) return { error: "Enter an amount." };
  if (!description.trim()) return { error: "Say what the adjustment is for." };
  await postLedger({ partnerId, kind: "adjust", amountCents, description: description.trim().slice(0, 200), actor, allowShort: true });
  if (amountCents > 0) await afterFunding(partnerId, new Date(), actor);
  return {};
}

// ── The monthly run (cron) ──────────────────────────────────────────────────

export async function drainPartnerBilling(now = new Date()): Promise<{ partners: number; charged: number; grace: number; suspended: number }> {
  const out = { partners: 0, charged: 0, grace: 0, suspended: 0 };
  if (!whiteLabelConfig().enabled) return out;
  const { data, error } = await db().from("wa_partners").select("id").eq("status", "active");
  if (error) throw error;
  for (const { id } of (data ?? []) as { id: string }[]) {
    const p = await getPartner(id);
    if (!p || (!p.setupPaidAt && p.setupFeeCents > 0)) continue;   // not live until the setup fee is paid
    out.partners++;
    try {
      const c = await chargePeriod(p, now);
      if (c.charged) {
        out.charged++;
        if (p.billingState !== "ok") {
          await db().from("wa_partners").update({ billing_state: "ok", grace_until: null }).eq("id", id);
          await resumePartnerWorkspaces(id, "billing");
        }
        continue;
      }
      if (!c.short) continue;
      if (p.billingState === "ok") {
        const until = new Date(now.getTime() + p.graceDays * DAY);
        await db().from("wa_partners").update({ billing_state: "grace", grace_until: until.toISOString() }).eq("id", id);
        await partnerAudit(id, "billing", "billing.grace", null, `${c.period}: needs ₹${c.amountCents / 100}`);
        await notifyOwners(p, "Add money to keep your customers running", "Your balance is short", [
          `This month's bill is ₹${(c.amountCents / 100).toLocaleString("en-IN")} and your available balance is ₹${(Math.max(0, available(p)) / 100).toLocaleString("en-IN")}.`,
          `Add money by ${until.toLocaleDateString("en-IN", { day: "numeric", month: "long" })}. After that, your customers' workspaces pause until you do. Nothing is deleted.`,
        ]);
        out.grace++;
      } else if (p.billingState === "grace" && p.graceUntil && Date.parse(p.graceUntil) <= now.getTime()) {
        await db().from("wa_partners").update({ billing_state: "suspended" }).eq("id", id);
        const n = await pausePartnerWorkspaces(id, "billing");
        await partnerAudit(id, "billing", "billing.suspended", null, `${n} workspace${n === 1 ? "" : "s"} paused`);
        await notifyOwners(p, "Your customers' workspaces are paused", "Workspaces paused", [
          `Your balance didn't cover this month's bill, so ${n} workspace${n === 1 ? " is" : "s are"} paused. Their data is safe.`,
          "Add money and they resume straight away.",
        ]);
        out.suspended++;
      }
    } catch (e) { console.error("[partner-billing]", id, e); }
  }
  return out;
}

// ── Partner ← its customers, through the partner's own Razorpay ─────────────

const RZP = "https://api.razorpay.com/v1";
const basic = (id: string, secret: string) => `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;

async function partnerKeys(partnerId: string): Promise<{ keyId: string; secret: string; webhookSecret: string | null } | null> {
  const { data } = await db().from("wa_partners").select("razorpay").eq("id", partnerId).maybeSingle();
  const r = (data?.razorpay ?? {}) as { keyId?: string; secretEnc?: string; webhookSecretEnc?: string };
  const secret = readSecret(r.secretEnc ?? null);
  if (!r.keyId || !secret) return null;
  return { keyId: r.keyId, secret, webhookSecret: readSecret(r.webhookSecretEnc ?? null) };
}

export async function savePartnerRazorpay(partner: Partner, input: { keyId?: string; keySecret?: string; webhookSecret?: string }, actor: string): Promise<{ error?: string }> {
  const keyId = (input.keyId ?? "").trim(), keySecret = (input.keySecret ?? "").trim(), webhookSecret = (input.webhookSecret ?? "").trim();
  if (!/^rzp_(live|test)_\w+$/.test(keyId)) return { error: "The Key ID starts with rzp_live_ or rzp_test_." };
  if (!keySecret) return { error: "Paste your Key Secret." };
  if (webhookSecret.length < 8) return { error: "Set a webhook secret of at least 8 characters, the same one you enter in Razorpay." };
  try {
    const res = await fetch(`${RZP}/payment_links?count=1`, { headers: { Authorization: basic(keyId, keySecret) }, signal: AbortSignal.timeout(8000) });
    if (res.status === 401) return { error: "Razorpay rejected these keys. Copy them again from Razorpay → Settings → API Keys." };
    if (!res.ok) return { error: `Razorpay answered HTTP ${res.status}. Check the keys and try again.` };
  } catch { return { error: "Couldn't reach Razorpay. Try again." }; }
  const { error } = await db().from("wa_partners").update({
    razorpay: { keyId, secretEnc: encryptSecret(keySecret), webhookSecretEnc: encryptSecret(webhookSecret) },
  }).eq("id", partner.id);
  if (error) throw error;
  await partnerAudit(partner.id, actor, "billing.razorpay_connected", null, keyId.startsWith("rzp_test_") ? "test keys" : "live keys");
  return {};
}

export function checkCustomerBilling(input: Partial<CustomerBilling>): { ok: true; v: CustomerBilling } | { ok: false; error: string } {
  const v = { ...CUSTOMER_BILLING_DEFAULTS, ...input };
  if (typeof v.autoLinks !== "boolean" || typeof v.autoPause !== "boolean") return { ok: false, error: "Invalid setting." };
  if (!Number.isInteger(v.graceDays) || v.graceDays < 1 || v.graceDays > 60) return { ok: false, error: "Grace days must be between 1 and 60." };
  return { ok: true, v: { autoLinks: v.autoLinks, graceDays: v.graceDays, autoPause: v.autoPause } };
}

export async function saveCustomerBilling(partner: Partner, input: Partial<CustomerBilling>, actor: string): Promise<{ error?: string; v?: CustomerBilling }> {
  const c = checkCustomerBilling(input);
  if (!c.ok) return { error: c.error };
  const { error } = await db().from("wa_partners").update({ customer_billing: c.v }).eq("id", partner.id);
  if (error) throw error;
  await partnerAudit(partner.id, actor, "billing.customer_settings", null, JSON.stringify(c.v));
  return { v: c.v };
}

export async function listCustomerInvoices(partnerId: string, limit = 200) {
  const { data, error } = await db().from("wa_partner_invoices").select("id,tenant_id,period,amount_cents,status,link_url,paid_at,created_at")
    .eq("partner_id", partnerId).order("created_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return (data ?? []).map(r => ({
    id: r.id as string, tenantId: r.tenant_id as string, period: r.period as string, amountCents: Number(r.amount_cents),
    status: r.status as string, url: (r.link_url as string | null) ?? null, paidAt: (r.paid_at as string | null) ?? null, at: r.created_at as string,
  }));
}

/** Send (or re-show) this month's payment link to one of the partner's customers. */
export async function sendCustomerInvoice(partner: Partner, tenantId: string, actor: string, now = new Date()): Promise<{ url?: string; status?: string; error?: string }> {
  const ws = await getPartnerWorkspace(partner.id, tenantId);
  if (!ws) return { error: "That workspace isn't one of yours." };
  const keys = await partnerKeys(partner.id);
  if (!keys) return { error: "Connect your Razorpay account first (Billing tab)." };
  const period = customerPeriod(now);
  const { data: existing } = await db().from("wa_partner_invoices").select("status,link_url").eq("tenant_id", tenantId).eq("period", period).maybeSingle();
  if (existing && existing.status !== "cancelled") return { url: (existing.link_url as string) ?? undefined, status: existing.status as string };

  const plans = await listPlans();
  const amount = partner.resalePrices[ws.plan] ?? plans.find(p => p.key === ws.plan)?.priceCents ?? 0;
  if (amount <= 0) return { error: "Set your price for this plan first (Prices tab)." };
  const { data: t } = await db().from("tenants").select("owner_name,owner_email,owner_phone").eq("id", tenantId).eq("partner_id", partner.id).maybeSingle();
  const res = await fetch(`${RZP}/payment_links`, {
    method: "POST", headers: { Authorization: basic(keys.keyId, keys.secret), "Content-Type": "application/json" }, signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({
      amount, currency: "INR", accept_partial: false, reminder_enable: true,
      description: `${ws.company || ws.name}: ${plans.find(p => p.key === ws.plan)?.name ?? ws.plan} plan, ${period}`,
      notes: { kind: "partner_customer", partner_id: partner.id, tenant_id: tenantId, period },
      ...(t?.owner_email ? { customer: { name: (t.owner_name as string) || undefined, email: t.owner_email as string, contact: (t.owner_phone as string) || undefined }, notify: { email: true, sms: false } } : {}),
    }),
  }).catch(() => null);
  if (!res || !res.ok) return { error: `Razorpay didn't create the link${res ? ` (HTTP ${res.status})` : ""}. Check your Razorpay keys.` };
  const d = (await res.json()) as { id: string; short_url: string };
  const { error } = await db().from("wa_partner_invoices").upsert({
    partner_id: partner.id, tenant_id: tenantId, period, amount_cents: amount, status: "sent", link_id: d.id, link_url: d.short_url,
  }, { onConflict: "tenant_id,period" });
  if (error) throw error;
  await partnerAudit(partner.id, actor, "billing.customer_link", tenantId, `${period} · ₹${amount / 100}`);
  return { url: d.short_url, status: "sent" };
}

/** The partner's own Razorpay webhook: verified with that partner's secret. */
export async function handlePartnerRazorpayWebhook(partnerId: string, raw: string, signature: string): Promise<{ status: number }> {
  const keys = await partnerKeys(partnerId);
  if (!keys?.webhookSecret) return { status: 404 };
  const expected = crypto.createHmac("sha256", keys.webhookSecret).update(raw).digest("hex");
  const a = Buffer.from(signature), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { status: 401 };
  let ev: { event?: string; payload?: { payment_link?: { entity?: { id?: string; notes?: Record<string, string> } } } };
  try { ev = JSON.parse(raw); } catch { return { status: 400 }; }
  const link = ev.payload?.payment_link?.entity;
  if (ev.event !== "payment_link.paid" || link?.notes?.kind !== "partner_customer" || link.notes.partner_id !== partnerId || !link.id) return { status: 200 };
  const { data } = await db().from("wa_partner_invoices").update({ status: "paid", paid_at: new Date().toISOString() })
    .eq("partner_id", partnerId).eq("link_id", link.id).neq("status", "paid").select("tenant_id");
  for (const r of (data ?? []) as { tenant_id: string }[]) {
    const { data: lifted } = await db().from("tenants").update({ status: "active", partner_pause: null })
      .eq("id", r.tenant_id).eq("partner_id", partnerId).eq("partner_pause", "unpaid").select("id");
    await partnerAudit(partnerId, "razorpay", "billing.customer_paid", r.tenant_id, lifted?.length ? "resumed" : "");
  }
  return { status: 200 };
}

/** Monthly links and unpaid pauses, for partners that switched them on. */
export async function drainCustomerBilling(now = new Date(), maxLinks = 40): Promise<{ links: number; paused: number }> {
  const out = { links: 0, paused: 0 };
  if (!whiteLabelConfig().enabled) return out;
  const { data } = await db().from("wa_partners").select("id,customer_billing").eq("status", "active");
  for (const row of (data ?? []) as { id: string; customer_billing: Partial<CustomerBilling> | null }[]) {
    const cb = { ...CUSTOMER_BILLING_DEFAULTS, ...(row.customer_billing ?? {}) };
    if (!cb.autoLinks && !cb.autoPause) continue;
    const partner = await getPartner(row.id);
    if (!partner || !partner.razorpay.connected) continue;
    try {
      if (cb.autoLinks && out.links < maxLinks) {
        const period = customerPeriod(now);
        const [{ data: live }, { data: sent }] = await Promise.all([
          db().from("tenants").select("id").eq("partner_id", partner.id).eq("status", "active"),
          db().from("wa_partner_invoices").select("tenant_id").eq("partner_id", partner.id).eq("period", period),
        ]);
        const done = new Set(((sent ?? []) as { tenant_id: string }[]).map(r => r.tenant_id));
        for (const t of (live ?? []) as { id: string }[]) {
          if (done.has(t.id) || out.links >= maxLinks) continue;
          const r = await sendCustomerInvoice(partner, t.id, "billing", now);
          if (r.url) out.links++;
        }
      }
      if (cb.autoPause) {
        const cutoff = new Date(now.getTime() - cb.graceDays * DAY).toISOString();
        const { data: overdue } = await db().from("wa_partner_invoices").select("tenant_id")
          .eq("partner_id", partner.id).eq("status", "sent").lt("created_at", cutoff);
        for (const r of (overdue ?? []) as { tenant_id: string }[]) {
          const { data: p } = await db().from("tenants").update({ status: "suspended", partner_pause: "unpaid" })
            .eq("id", r.tenant_id).eq("partner_id", partner.id).eq("status", "active").is("partner_pause", null).select("id");
          if (p?.length) { out.paused++; await partnerAudit(partner.id, "billing", "billing.customer_unpaid", r.tenant_id); }
        }
      }
    } catch (e) { console.error("[partner-billing] customers", row.id, e); }
  }
  return out;
}

// ── Emails to the partner's owners ──────────────────────────────────────────

async function notifyOwners(partner: Partner, subject: string, heading: string, paragraphs: string[]): Promise<void> {
  const owners = (await listPartnerUsers(partner.id).catch(() => [])).filter(u => u.role === "owner" && u.active && u.hasPassword);
  if (!owners.length) return;
  const brand = brandFromPartner(partner);
  const { html, text } = renderEmail({
    brand: { name: brand.name, logoUrl: brand.logoUrl },
    preheader: paragraphs[0] ?? subject, heading, paragraphs,
    cta: { label: "Open billing", href: "/partner" },
    footerReason: `You're getting this because you're an owner of the ${brand.name} partner account.`,
  }, origin(partner));
  for (const o of owners) {
    await sendEmail({ to: o.email, subject, html, text, type: "other", fromName: "Talko partner billing" }).catch(() => undefined);
  }
}

// ── Owner control room ──────────────────────────────────────────────────────

export interface PartnerStats { live: number; paused: number; revenue30dCents: number; alerts: number }

/**
 * Per partner: live and paused workspaces, what Talko took from its balance in
 * the last 30 days, and quality alerts on its customers' WhatsApp numbers
 * (from the owner console's fleet metrics). A few queries in total, not a set
 * per partner. Tolerates the billing migration not being applied yet.
 */
export async function ownerPartnerStats(): Promise<Record<string, PartnerStats>> {
  const out: Record<string, PartnerStats> = {};
  const get = (id: string) => (out[id] ??= { live: 0, paused: 0, revenue30dCents: 0, alerts: 0 });
  const { data: ts } = await db().from("tenants").select("id,partner_id,status").not("partner_id", "is", null);
  const owner = new Map<string, string>();
  for (const t of (ts ?? []) as { id: string; partner_id: string; status: string }[]) {
    owner.set(t.id, t.partner_id);
    if (t.status === "suspended" || t.status === "cancelled") get(t.partner_id).paused++; else get(t.partner_id).live++;
  }
  try {
    const since = new Date(Date.now() - 30 * DAY).toISOString();
    const { data: led } = await db().from("wa_partner_ledger").select("partner_id,amount_cents").lt("amount_cents", 0).gte("created_at", since);
    for (const l of (led ?? []) as { partner_id: string; amount_cents: number }[]) get(l.partner_id).revenue30dCents += -Number(l.amount_cents);
  } catch { /* billing migration not applied yet */ }
  if (owner.size) {
    try {
      const { data: m } = await db().from("tenant_metrics").select("tenant_id,wa_quality,marketing_paused").in("tenant_id", [...owner.keys()]);
      for (const r of (m ?? []) as { tenant_id: string; wa_quality: string | null; marketing_paused: boolean | null }[]) {
        const bad = r.marketing_paused || (r.wa_quality && !/^green|high$/i.test(r.wa_quality));
        if (bad) get(owner.get(r.tenant_id)!).alerts++;
      }
    } catch { /* fleet metrics not set up */ }
  }
  return out;
}
