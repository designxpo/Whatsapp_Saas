// Integration health — one place that says which connections are working and
// which aren't, and what to do about each. Built only from what the app already
// records (no calls to Meta or Google here), so it's fast and safe to show on
// every visit:
//
//   WhatsApp numbers   messaging_health / quality_rating from Meta's webhooks
//   Instagram          a token refresh that failed (igtokensweep.ts), or one too old to be alive
//   Google Reviews     the sync status per location (reviewpoller.ts)
//   Inbound connectors last_error on the connection, failed events in the last day
//   Outbound           wa_integrations.status = error
//   Deliveries         wa_crm_sync rows that gave up ("dead") — can be retried
//   Payments           wa_unmatched_payments still open — match to an order or dismiss
//
// Problems carry a stable `key` and a `since`, so an alert is raised once per
// problem (work-alerts.ts), and again only if it comes back later.

import { db } from "./supabase";
import { tdb } from "./tenantdb";
import { getTenantSetting } from "./store";
import { igTokenErrorKey, igTokenRefreshedKey } from "./iglogin";
import { getChannelSync } from "./reviews";
import { markOrderPaid } from "./commerce";

export type Severity = "critical" | "warning";
export type Area = "whatsapp" | "instagram" | "messenger" | "google" | "inbound" | "outbound" | "deliveries" | "payments";

export interface Problem {
  key: string;
  area: Area;
  severity: Severity;
  title: string;
  detail: string;
  since: string;
  fix: { label: string; tab: "setup" | "integrations" | "reviews" | "catalog" | "instagram" | "facebook" };
}

export interface HealthReport {
  problems: Problem[];
  checked: { area: Area; name: string; ok: boolean }[];
  unmatchedPayments: UnmatchedPayment[];
  deadDeliveries: number;
}

export interface UnmatchedPayment {
  id: string; provider: string; paymentKey: string; amountCents: number | null; reason: "no_order" | "short_payment";
  orderId: string | null; createdAt: string;
  /** Pending orders this could belong to: same amount, last 7 days. */
  candidates: { id: string; phone: string; totalCents: number; createdAt: string }[];
}

const DAY = 86_400_000;
const IG_TOKEN_LIFE_DAYS = 60;
const missing = (e: { code?: string } | null | undefined) => !!e && ["42P01", "PGRST205", "42703", "PGRST204"].includes(e.code ?? "");

type ChannelRow = { id: string; kind: string; name: string; active: boolean; token: string | null; created_at: string; messaging_health?: string | null; quality_rating?: string | null; quality_updated_at?: string | null };

export async function healthReport(tenantId: string, now: number = Date.now()): Promise<HealthReport> {
  const problems: Problem[] = [];
  const checked: HealthReport["checked"] = [];

  const { data: chs } = await db().from("wa_channels").select("*").eq("tenant_id", tenantId);
  const channels = ((chs ?? []) as ChannelRow[]).filter(c => c.active);
  for (const c of channels) {
    if (c.kind === "whatsapp") {
      const h = (c.messaging_health ?? "").toUpperCase();
      const q = (c.quality_rating ?? "").toUpperCase();
      const since = c.quality_updated_at ?? c.created_at;
      if (h === "RESTRICTED" || h === "BLOCKED") {
        problems.push({ key: `wa:${c.id}:restricted`, area: "whatsapp", severity: "critical", since, title: `WhatsApp number “${c.name}” is restricted`,
          detail: "Meta has limited what this number can send. Messages to customers may not go out until it's resolved in Meta Business Manager.", fix: { label: "Check the number", tab: "setup" } });
      } else if (h === "FLAGGED" || q === "RED") {
        problems.push({ key: `wa:${c.id}:quality`, area: "whatsapp", severity: "warning", since, title: `WhatsApp number “${c.name}” has low quality`,
          detail: "Customers have been blocking or reporting messages. Pause marketing sends and review your templates before Meta restricts the number.", fix: { label: "Check the number", tab: "setup" } });
      }
      checked.push({ area: "whatsapp", name: c.name, ok: !problems.some(p => p.key.startsWith(`wa:${c.id}:`)) });
    }
    if (c.kind === "instagram" || c.kind === "messenger") {
      const area = c.kind as Area;
      const err = await getTenantSetting<{ error: string; at: string } | null>(tenantId, igTokenErrorKey(c.id), null).catch(() => null);
      const refreshed = await getTenantSetting<string | null>(tenantId, igTokenRefreshedKey(c.id), null).catch(() => null);
      const age = (now - Date.parse(refreshed ?? c.created_at)) / DAY;
      if (c.kind === "instagram" && err?.at) {
        problems.push({ key: `ig:${c.id}:token`, area, severity: "critical", since: err.at, title: `Instagram account “${c.name}” needs reconnecting`,
          detail: `Its access couldn't be renewed (${err.error}). Replies and comments stop working when it expires.`, fix: { label: "Reconnect Instagram", tab: "instagram" } });
      } else if (c.kind === "instagram" && Number.isFinite(age) && age > IG_TOKEN_LIFE_DAYS) {
        problems.push({ key: `ig:${c.id}:expired`, area, severity: "critical", since: new Date(Date.parse(refreshed ?? c.created_at) + IG_TOKEN_LIFE_DAYS * DAY).toISOString(),
          title: `Instagram account “${c.name}” has probably expired`, detail: "Its access hasn't been renewed for over 60 days, which is when Instagram access runs out.", fix: { label: "Reconnect Instagram", tab: "instagram" } });
      }
      checked.push({ area, name: c.name, ok: !problems.some(p => p.key.startsWith(`ig:${c.id}:`)) });
    }
    if (c.kind === "google_reviews") {
      const s = await getChannelSync(tenantId, c.id).catch(() => null);
      if (s && !s.ok && (s.kind === "reauth" || s.kind === "permission")) {
        problems.push({ key: `google:${c.id}:${s.kind}`, area: "google", severity: "critical", since: s.at, title: `Google Reviews lost access to “${c.name}”`,
          detail: s.kind === "reauth" ? "Google access expired or was removed. Reviews won't sync and replies can't be posted." : "The connected Google account can no longer manage this location.", fix: { label: "Reconnect Google", tab: "reviews" } });
      } else if (s && !s.ok && s.failures >= 3) {
        problems.push({ key: `google:${c.id}:failing`, area: "google", severity: "warning", since: s.lastSuccessAt ?? s.at, title: `Google Reviews keeps failing to sync “${c.name}”`,
          detail: s.error ?? "The last few syncs failed.", fix: { label: "Open Reviews", tab: "reviews" } });
      }
      checked.push({ area: "google", name: c.name, ok: !problems.some(p => p.key.startsWith(`google:${c.id}:`)) });
    }
  }

  // Inbound connectors (Shopify, Razorpay, Calendly…): an error newer than the last good event.
  const { data: inb, error: inbErr } = await tdb(tenantId).from("wa_inbound_connections").select("id,kind,status,last_event_at,last_error,last_error_at");
  for (const c of ((inbErr ? [] : inb) ?? []) as unknown as { id: string; kind: string; status: string; last_event_at: string | null; last_error: string | null; last_error_at: string | null }[]) {
    if (c.status === "disabled" || c.status === "paused") continue;
    const broken = !!c.last_error_at && (!c.last_event_at || c.last_error_at > c.last_event_at) && now - Date.parse(c.last_error_at) < 7 * DAY;
    if (broken) problems.push({ key: `inbound:${c.id}`, area: "inbound", severity: "warning", since: c.last_error_at!, title: `${label(c.kind)} events are failing`,
      detail: c.last_error ?? "The last event couldn't be processed.", fix: { label: "Open the connection", tab: "integrations" } });
    checked.push({ area: "inbound", name: label(c.kind), ok: !broken });
  }

  // Outbound integrations (Slack, Sheets, Zapier, webhooks…).
  const { data: out } = await tdb(tenantId).from("wa_integrations").select("id,kind,name,active,status,status_detail,updated_at");
  for (const i of ((out ?? []) as unknown as { id: string; kind: string; name: string; active: boolean; status: string; status_detail: string | null; updated_at: string }[]).filter(x => x.active)) {
    const bad = i.status === "error";
    if (bad) problems.push({ key: `outbound:${i.id}`, area: "outbound", severity: "warning", since: i.updated_at, title: `“${i.name || label(i.kind)}” isn't receiving updates`,
      detail: i.status_detail ?? "The last test or delivery failed.", fix: { label: "Test the integration", tab: "integrations" } });
    checked.push({ area: "outbound", name: i.name || label(i.kind), ok: !bad });
  }

  // Deliveries that gave up after their retries (CRM pushes, integration events).
  const { count: dead } = await db().from("wa_crm_sync").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("status", "dead");
  if (dead) {
    const { data: newest } = await db().from("wa_crm_sync").select("created_at,last_error").eq("tenant_id", tenantId).eq("status", "dead").order("created_at", { ascending: false }).limit(1);
    const n = (newest ?? [])[0] as { created_at: string; last_error: string | null } | undefined;
    problems.push({ key: "deliveries:dead", area: "deliveries", severity: "warning", since: n?.created_at ?? new Date(now).toISOString(),
      title: `${dead} update${dead === 1 ? "" : "s"} couldn't be delivered`, detail: n?.last_error ? `Latest error: ${n.last_error}` : "They gave up after several retries. You can try them again.",
      fix: { label: "Retry them", tab: "integrations" } });
  }

  // Money that arrived without an order to match.
  const unmatchedPayments = await openUnmatchedPayments(tenantId, now);
  for (const p of unmatchedPayments) {
    problems.push({ key: `payment:${p.id}`, area: "payments", severity: "warning", since: p.createdAt,
      title: p.reason === "short_payment" ? "A payment was less than its order" : "A payment matched no order",
      detail: `${p.provider} payment ${p.paymentKey}${p.amountCents != null ? ` for ₹${(p.amountCents / 100).toLocaleString("en-IN")}` : ""}.`, fix: { label: "Match it", tab: "integrations" } });
  }

  const rank = { critical: 0, warning: 1 };
  problems.sort((a, b) => rank[a.severity] - rank[b.severity] || b.since.localeCompare(a.since));
  return { problems, checked, unmatchedPayments, deadDeliveries: dead ?? 0 };
}

function label(kind: string): string {
  const k = kind.replace(/[_-]/g, " ");
  return k.charAt(0).toUpperCase() + k.slice(1);
}

async function openUnmatchedPayments(tenantId: string, now: number): Promise<UnmatchedPayment[]> {
  const { data, error } = await tdb(tenantId).from("wa_unmatched_payments").select("*").eq("status", "open").order("created_at", { ascending: false }).limit(20);
  if (error || !data?.length) return [];
  const { data: pending } = await db().from("wa_orders").select("id,phone,total_cents,created_at").eq("tenant_id", tenantId).eq("status", "pending")
    .gte("created_at", new Date(now - 7 * DAY).toISOString()).limit(200);
  const orders = (pending ?? []) as { id: string; phone: string; total_cents: number; created_at: string }[];
  return (data as unknown as Record<string, unknown>[]).map(r => ({
    id: r.id as string, provider: r.provider as string, paymentKey: r.payment_key as string, amountCents: (r.amount_cents as number | null) ?? null,
    reason: r.reason as "no_order" | "short_payment", orderId: (r.order_id as string | null) ?? null, createdAt: r.created_at as string,
    candidates: r.reason === "no_order" && r.amount_cents != null
      ? orders.filter(o => o.total_cents === r.amount_cents).map(o => ({ id: o.id, phone: o.phone, totalCents: o.total_cents, createdAt: o.created_at }))
      : [],
  }));
}

/** Give dead deliveries another go: back to pending, due now. Returns how many. */
export async function retryDeadDeliveries(tenantId: string): Promise<number> {
  const { data } = await db().from("wa_crm_sync").update({ status: "pending", attempts: 0, next_attempt_at: new Date().toISOString() })
    .eq("tenant_id", tenantId).eq("status", "dead").select("id");
  return data?.length ?? 0;
}

/**
 * Settle an unmatched payment: mark the chosen order paid (the same path a
 * gateway webhook takes, so receipts, events and lead status all follow), or
 * dismiss it. A short payment can only be dismissed — it was already linked.
 */
export async function resolveUnmatchedPayment(tenantId: string, id: string, action: { orderId: string } | { dismiss: true }, actor: string): Promise<{ ok?: true; error?: string; status?: number }> {
  const { data: row, error } = await tdb(tenantId).from("wa_unmatched_payments").select("*").eq("id", id).eq("status", "open").maybeSingle();
  if (error && missing(error)) return { error: "Payment checks are still being set up for your workspace.", status: 503 };
  const p = row as Record<string, unknown> | null;
  if (!p) return { error: "That payment was already settled.", status: 409 };
  const close = (status: "matched" | "dismissed", orderId: string | null) => tdb(tenantId).from("wa_unmatched_payments")
    .update({ status, resolved_by: actor, resolved_at: new Date().toISOString(), ...(orderId ? { order_id: orderId } : {}) }).eq("id", id).eq("status", "open");
  if ("dismiss" in action) { await close("dismissed", null); return { ok: true }; }
  if (p.reason !== "no_order") return { error: "A short payment can only be dismissed after you've sorted it with the customer.", status: 400 };
  const { data: order } = await db().from("wa_orders").select("id,status,total_cents").eq("tenant_id", tenantId).eq("id", action.orderId).maybeSingle();
  const o = order as { id: string; status: string; total_cents: number } | null;
  if (!o) return { error: "That order isn't in this workspace.", status: 404 };
  if (o.status !== "pending") return { error: "That order isn't waiting for payment.", status: 409 };
  if (p.amount_cents != null && (p.amount_cents as number) < o.total_cents) return { error: "This payment is less than that order's total.", status: 400 };
  const paid = await markOrderPaid({ orderId: o.id, expectTenantId: tenantId, providerPaymentId: (p.provider_payment_id as string | null) ?? undefined,
    amountPaidCents: (p.amount_cents as number | null) ?? undefined, provider: p.provider === "stripe" ? "stripe" : p.provider === "razorpay" ? "razorpay" : undefined });
  if (!paid.ok) return { error: "Couldn't mark that order paid.", status: 500 };
  await close("matched", o.id);
  return { ok: true };
}
