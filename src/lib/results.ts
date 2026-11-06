// Results — business outcomes, not message counts: paid orders and revenue by
// where the customer came from; Meta ads → leads → qualified → paid; broadcasts
// → orders in the following week; social comments → WhatsApp → sales; how
// often the AI's "ready to pay" read turned into a payment; and what's slipping.
//
// Honesty rules (shown on the screen too):
//  - Broadcast and ad revenue is ATTRIBUTED: an order from someone who got the
//    message, not proof the message caused it.
//  - Orders placed before sources were saved fall back to the customer's
//    current record, and say so.
//  - Phones are matched on their last 10 digits, as the rest of the app does.

import { db } from "./supabase";
import { tdb } from "./tenantdb";
import { sourceFromAttributes, type OrderSource } from "./order-source";
import { listHandoffs } from "./handoff";

const DAY = 86_400_000;
const key10 = (p: string | null | undefined) => (p ?? "").replace(/\D/g, "").slice(-10);
const QUALIFIED = new Set(["Hot", "Won"]);

export interface ResultsReport {
  days: number;
  revenueCents: number;
  paidOrders: number;
  currency: string;
  bySource: { channel: string; orders: number; revenueCents: number; fromCustomerRecord: number }[];
  ads: { adId: string; name: string; leads: number; qualified: number; paidCustomers: number; revenueCents: number }[];
  broadcasts: { campaignId: string; name: string; reached: number; buyers: number; revenueCents: number }[];
  social: { platform: string; invites: number; chats: number; orders: number; revenueCents: number }[];
  aiReads: { readyToPay: number; paidWithin14Days: number; notReadyButPaid: number } | null;
  missed: { readyNotPaid: number; unpaidOrders: number; unpaidValueCents: number };
}

type Order = { id: string; phone: string; total_cents: number; currency: string | null; source: OrderSource | null; paid_at: string | null; created_at: string; status: string };

export async function resultsReport(tenantId: string, days: number, now: number = Date.now()): Promise<ResultsReport> {
  const since = new Date(now - days * DAY).toISOString();

  // Paid orders in the period (paid_at, or created_at for orders paid before it was recorded).
  const { data: od } = await db().from("wa_orders").select("*").eq("tenant_id", tenantId).in("status", ["paid", "fulfilled"]).gte("created_at", new Date(now - (days + 30) * DAY).toISOString()).limit(5000);
  const paid = ((od ?? []) as Order[]).filter(o => (o.paid_at ?? o.created_at) >= since);
  const revenueCents = paid.reduce((n, o) => n + (o.total_cents ?? 0), 0);
  const currency = paid[0]?.currency ?? "INR";

  // Contacts for every phone we need (orders without a saved source, ad leads, read phones).
  const { data: cd } = await tdb(tenantId).from("contacts").select("phone,attributes,opt_in_source,created_at").limit(20000);
  const contacts = (cd ?? []) as unknown as { phone: string; attributes: Record<string, unknown> | null; opt_in_source: string | null; created_at: string }[];
  const contactBy = new Map(contacts.map(c => [key10(c.phone), c]));

  const src = new Map<string, { orders: number; revenueCents: number; fromCustomerRecord: number }>();
  for (const o of paid) {
    let s = o.source, fallback = false;
    if (!s?.channel) { const c = contactBy.get(key10(o.phone)); s = sourceFromAttributes(c?.attributes, c?.opt_in_source); fallback = true; }
    const cur = src.get(s.channel) ?? { orders: 0, revenueCents: 0, fromCustomerRecord: 0 };
    cur.orders++; cur.revenueCents += o.total_cents ?? 0; if (fallback) cur.fromCustomerRecord++;
    src.set(s.channel, cur);
  }
  const bySource = [...src].map(([channel, v]) => ({ channel, ...v })).sort((a, b) => b.revenueCents - a.revenueCents);

  // Paid orders per customer, for funnels below.
  const paidBy = new Map<string, Order[]>();
  for (const o of paid) paidBy.set(key10(o.phone), [...(paidBy.get(key10(o.phone)) ?? []), o]);

  // Meta ads: customers who first came from an ad in the period → qualified → paid.
  const adLeads = contacts.filter(c => typeof c.attributes?.ad_id === "string" && c.created_at >= since);
  const { data: convs } = adLeads.length ? await db().from("wa_conversations").select("phone,lead_status,ready_to_pay").eq("tenant_id", tenantId).limit(20000) : { data: [] };
  const qualifiedPhones = new Set(((convs ?? []) as { phone: string; lead_status: string | null; ready_to_pay: boolean | null }[])
    .filter(c => QUALIFIED.has(c.lead_status ?? "") || c.ready_to_pay).map(c => key10(c.phone)));
  const adMap = new Map<string, { name: string; leads: number; qualified: number; paidCustomers: number; revenueCents: number }>();
  for (const c of adLeads) {
    const id = String(c.attributes!.ad_id);
    const cur = adMap.get(id) ?? { name: (c.attributes!.ad_headline as string) || `Ad ${id}`, leads: 0, qualified: 0, paidCustomers: 0, revenueCents: 0 };
    const k = key10(c.phone);
    cur.leads++;
    if (qualifiedPhones.has(k) || paidBy.has(k)) cur.qualified++;
    const theirs = paidBy.get(k) ?? [];
    if (theirs.length) { cur.paidCustomers++; cur.revenueCents += theirs.reduce((n, o) => n + o.total_cents, 0); }
    adMap.set(id, cur);
  }
  const ads = [...adMap].map(([adId, v]) => ({ adId, ...v })).sort((a, b) => b.revenueCents - a.revenueCents || b.leads - a.leads).slice(0, 20);

  // Broadcasts: people a campaign reached in the period who paid within 7 days after.
  const { data: sends } = await db().from("wa_send_log").select("campaign_id,phone,status,sent_at").eq("tenant_id", tenantId).gte("sent_at", since).in("status", ["sent", "delivered", "read"]).limit(50000);
  const byCampaign = new Map<string, { reached: Set<string>; buyers: Set<string>; revenueCents: number; counted: Set<string> }>();
  for (const s of (sends ?? []) as { campaign_id: string; phone: string; sent_at: string }[]) {
    if (!s.campaign_id) continue;
    const cur = byCampaign.get(s.campaign_id) ?? { reached: new Set(), buyers: new Set(), revenueCents: 0, counted: new Set() };
    const k = key10(s.phone);
    cur.reached.add(k);
    for (const o of paidBy.get(k) ?? []) {
      const at = Date.parse(o.paid_at ?? o.created_at), sent = Date.parse(s.sent_at);
      if (at >= sent && at - sent <= 7 * DAY && !cur.counted.has(o.id)) { cur.counted.add(o.id); cur.buyers.add(k); cur.revenueCents += o.total_cents; }
    }
    byCampaign.set(s.campaign_id, cur);
  }
  const ids = [...byCampaign.keys()];
  const { data: camps } = ids.length ? await db().from("wa_campaigns").select("id,name,template_name").eq("tenant_id", tenantId).in("id", ids) : { data: [] };
  const campName = new Map(((camps ?? []) as { id: string; name: string | null; template_name: string | null }[]).map(c => [c.id, c.name || c.template_name || "A broadcast"]));
  const broadcasts = [...byCampaign].map(([campaignId, v]) => ({ campaignId, name: campName.get(campaignId) ?? "A broadcast", reached: v.reached.size, buyers: v.buyers.size, revenueCents: v.revenueCents }))
    .sort((a, b) => b.revenueCents - a.revenueCents || b.reached - a.reached).slice(0, 20);

  // Social comments → WhatsApp → sales (the handoff summary each social tab already shows).
  const social: ResultsReport["social"] = [];
  for (const platform of ["instagram", "facebook", "youtube"] as const) {
    const r = await listHandoffs(tenantId, { platform, days }).catch(() => null);
    if (r?.summary && r.summary.sent) social.push({ platform, invites: r.summary.sent, chats: r.summary.started, orders: r.summary.orders, revenueCents: r.summary.revenueCents });
  }

  // Was the AI right? "Ready to pay" reads in the period, and whether they paid within 14 days.
  let aiReads: ResultsReport["aiReads"] = null;
  const { data: reads, error: readErr } = await tdb(tenantId).from("wa_lead_reads").select("phone,status,ready_to_pay,created_at").gte("created_at", since).limit(20000);
  if (!readErr) {
    const all = (reads ?? []) as unknown as { phone: string; status: string | null; ready_to_pay: boolean; created_at: string }[];
    const firstReady = new Map<string, number>();
    for (const r of all) if (r.ready_to_pay) { const k = key10(r.phone); const t = Date.parse(r.created_at); if (!firstReady.has(k) || t < firstReady.get(k)!) firstReady.set(k, t); }
    const paidSoon = [...firstReady].filter(([k, t]) => (paidBy.get(k) ?? []).some(o => { const at = Date.parse(o.paid_at ?? o.created_at); return at >= t && at - t <= 14 * DAY; })).length;
    const coldPhones = new Set(all.filter(r => !r.ready_to_pay && (r.status === "Cold" || r.status === "Lost")).map(r => key10(r.phone)));
    const notReadyButPaid = [...coldPhones].filter(k => !firstReady.has(k) && paidBy.has(k)).length;
    aiReads = { readyToPay: firstReady.size, paidWithin14Days: paidSoon, notReadyButPaid };
  }

  // What's slipping: leads read as ready to pay with no payment yet, and orders unpaid for a day.
  const { data: ready } = await db().from("wa_conversations").select("phone").eq("tenant_id", tenantId).eq("ready_to_pay", true).gte("lead_scored_at", since).limit(5000);
  const { data: unpaid } = await db().from("wa_orders").select("total_cents,created_at").eq("tenant_id", tenantId).eq("status", "pending").gte("created_at", since).lte("created_at", new Date(now - DAY).toISOString()).limit(5000);
  const missed = {
    readyNotPaid: ((ready ?? []) as { phone: string }[]).filter(c => !paidBy.has(key10(c.phone))).length,
    unpaidOrders: (unpaid ?? []).length,
    unpaidValueCents: ((unpaid ?? []) as { total_cents: number }[]).reduce((n, o) => n + (o.total_cents ?? 0), 0),
  };

  return { days, revenueCents, paidOrders: paid.length, currency, bySource, ads, broadcasts, social, aiReads, missed };
}
