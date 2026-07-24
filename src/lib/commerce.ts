import { DEFAULT_TENANT_ID } from "./tenant";
// Commerce — products, carts, orders. Cart RECOVERY is not a bespoke feature:
// it's a Sequence (trigger_kind='cart_abandoned') that the cron enrolls idle
// carts into. Browse/checkout reuse the WhatsApp product messages + Flows.

import { db } from "./supabase";
import { getSequenceByTrigger, enroll } from "./sequences";
import { emitEvent, createPaymentLink, type ImportedProduct } from "./integrations";
import { sendText } from "./whatsapp";
import { credsFor } from "./channels";


export interface CartItem { productId: string; name: string; qty: number; priceCents: number }
export interface Product { id: string; name: string; description: string | null; priceCents: number; currency: string; imageUrl: string | null; retailerId: string | null; metaProductId: string | null; catalogId: string | null; available: boolean; buttonText: string | null; buttonUrl: string | null }

function mapProduct(r: Record<string, unknown>): Product {
  return {
    id: r.id as string, name: r.name as string, description: (r.description as string | null) ?? null,
    priceCents: (r.price_cents as number) ?? 0, currency: (r.currency as string) ?? "INR",
    imageUrl: (r.image_url as string | null) ?? null, retailerId: (r.retailer_id as string | null) ?? null,
    metaProductId: (r.meta_product_id as string | null) ?? null, catalogId: (r.catalog_id as string | null) ?? null,
    available: (r.available as boolean) ?? true,
    buttonText: (r.button_text as string | null) ?? null, buttonUrl: (r.button_url as string | null) ?? null,
  };
}

// ── Products ──────────────────────────────────────────────────────────────────
export async function listProducts(tenantId = DEFAULT_TENANT_ID): Promise<Product[]> {
  const { data } = await db().from("wa_products").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false });
  return (data ?? []).map(r => mapProduct(r as Record<string, unknown>));
}

// Auto-generated SKU / product_retailer_id for new products when the admin
// leaves it blank — a name slug + short random suffix (unique enough for a small
// catalog; this id is what catalog/product messages reference).
function genRetailerId(name: string): string {
  const slug = name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24);
  return `${slug || "PROD"}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

export async function saveProduct(p: Partial<Product> & { name: string }, tenantId = DEFAULT_TENANT_ID): Promise<Product> {
  const retailerId = p.retailerId?.trim() || (p.id ? null : genRetailerId(p.name));
  const base = {
    tenant_id: tenantId,
    name: p.name.trim(), description: p.description ?? null, price_cents: p.priceCents ?? 0,
    currency: p.currency ?? "INR", image_url: p.imageUrl ?? null, retailer_id: retailerId,
    meta_product_id: p.metaProductId ?? null, catalog_id: p.catalogId ?? null, available: p.available ?? true,
  };
  const withButton = { ...base, button_text: p.buttonText?.trim() || null, button_url: p.buttonUrl?.trim() || null };
  const run = (row: Record<string, unknown>) => (p.id
    ? db().from("wa_products").update(row).eq("tenant_id", tenantId).eq("id", p.id).select().single()
    : db().from("wa_products").insert(row).select().single());
  let { data, error } = await run(withButton);
  // Graceful degradation when migration 0050 (button_text/button_url) isn't applied yet.
  if (error && /button_text|button_url|column/i.test(error.message ?? "")) ({ data, error } = await run(base));
  if (error) throw error;
  return mapProduct(data as Record<string, unknown>);
}

export async function getProduct(id: string, tenantId = DEFAULT_TENANT_ID): Promise<Product | null> {
  const { data } = await db().from("wa_products").select("*").eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  return data ? mapProduct(data as Record<string, unknown>) : null;
}

export async function deleteProduct(id: string, tenantId = DEFAULT_TENANT_ID): Promise<void> {
  await db().from("wa_products").delete().eq("tenant_id", tenantId).eq("id", id);
}

// Import (or refresh) products pulled from an external store. Idempotent: each
// product is keyed by retailer_id = "<source>:<externalId>", so re-syncing
// UPDATES the existing rows instead of duplicating the catalog.
export async function importProducts(items: ImportedProduct[], source: string, tenantId = DEFAULT_TENANT_ID): Promise<{ imported: number; updated: number }> {
  const rid = (it: ImportedProduct) => `${source}:${it.externalId}`;
  const ridList = items.map(rid);
  let existing: { id: string; retailer_id: string }[] = [];
  if (ridList.length) {
    const { data } = await db().from("wa_products").select("id,retailer_id").eq("tenant_id", tenantId).in("retailer_id", ridList);
    existing = (data ?? []) as { id: string; retailer_id: string }[];
  }
  const byRid = new Map(existing.map(r => [r.retailer_id, r.id]));
  let imported = 0, updated = 0;
  for (const it of items) {
    if (!it.externalId) continue;
    const row = {
      name: it.name.trim() || "Product", description: it.description, price_cents: it.priceCents,
      currency: it.currency || "INR", image_url: it.imageUrl, available: it.available, retailer_id: rid(it),
    };
    const id = byRid.get(rid(it));
    if (id) { await db().from("wa_products").update(row).eq("tenant_id", tenantId).eq("id", id); updated++; }
    else { await db().from("wa_products").insert({ ...row, tenant_id: tenantId }); imported++; }
  }
  return { imported, updated };
}

// ── Carts ─────────────────────────────────────────────────────────────────────
export async function getOpenCart(phone: string, tenantId = DEFAULT_TENANT_ID): Promise<{ id: string; items: CartItem[] } | null> {
  const { data } = await db().from("wa_carts").select("id, items").eq("tenant_id", tenantId).eq("phone", phone).eq("status", "open").maybeSingle();
  return data ? { id: data.id as string, items: (data.items as CartItem[]) ?? [] } : null;
}

// Create/replace the open cart for a contact (resets the abandonment clock).
export async function upsertCart(p: { phone: string; platform?: "whatsapp" | "instagram"; conversationId?: string | null; items: CartItem[] }, tenantId = DEFAULT_TENANT_ID): Promise<string> {
  const existing = await getOpenCart(p.phone, tenantId);
  const now = new Date().toISOString();
  if (existing) {
    await db().from("wa_carts").update({ items: p.items, recovery_sent: false, updated_at: now }).eq("id", existing.id);
    return existing.id;
  }
  const { data, error } = await db().from("wa_carts").insert({
    tenant_id: tenantId, phone: p.phone, platform: p.platform ?? "whatsapp", conversation_id: p.conversationId ?? null,
    items: p.items, status: "open",
  }).select("id").single();
  if (error) throw error;
  return data!.id as string;
}

// Convert an open cart into an order.
export async function checkoutCart(p: { phone: string; paymentRef?: string }, tenantId = DEFAULT_TENANT_ID): Promise<{ orderId: string; totalCents: number; paymentUrl: string | null } | null> {
  const cart = await getOpenCart(p.phone, tenantId);
  if (!cart) return null;
  const total = cart.items.reduce((s, i) => s + i.priceCents * i.qty, 0);
  const { data, error } = await db().from("wa_orders").insert({
    tenant_id: tenantId, cart_id: cart.id, phone: p.phone, items: cart.items, total_cents: total, status: p.paymentRef ? "paid" : "pending", payment_ref: p.paymentRef ?? null,
  }).select("id").single();
  if (error) throw error;
  await db().from("wa_carts").update({ status: "ordered", updated_at: new Date().toISOString() }).eq("id", cart.id);
  const orderId = data!.id as string;
  // Fire the order_placed event → optional post-purchase sequence (this tenant's).
  const seq = await getSequenceByTrigger("order_placed", null, tenantId);
  if (seq) await enroll(seq.id, { phone: p.phone, platform: "whatsapp" }, tenantId);
  // Fan out to connected integrations (Zapier/Sheets/Slack…) — best-effort.
  void emitEvent(tenantId, "order.created", { orderId, phone: p.phone, totalCents: total });
  // Unpaid order → if the tenant connected a payment provider, mint a hosted
  // pay link so the customer can complete checkout in chat. Best-effort.
  let paymentUrl: string | null = null;
  if (!p.paymentRef && total > 0) {
    const link = await createPaymentLink(tenantId, { amountCents: total, description: `Order ${orderId.slice(0, 8)}`, phone: p.phone });
    if (link) {
      paymentUrl = link.url;
      await db().from("wa_orders").update({ payment_ref: link.id }).eq("id", orderId).then(() => {}, () => {});
    }
  }
  return { orderId, totalCents: total, paymentUrl };
}

// ── Payment confirmation ──────────────────────────────────────────────────────
// Called by a SIGNATURE-VERIFIED payment webhook (Razorpay / Stripe) when a
// hosted pay link is paid. Reconciles by `payment_ref` (the provider's link id,
// which checkoutCart stored) — the tenant is DERIVED from the matched row, never
// trusted from the webhook payload. Exactly-once: the pending→paid transition is
// a guarded UPDATE, so a duplicate/late webhook updates 0 rows and fires no
// side-effects again.
export async function markOrderPaid(m: {
  paymentRef?: string;         // provider hosted-link id (matches wa_orders.payment_ref)
  orderId?: string;            // or an explicit order id
  providerPaymentId?: string;  // the actual gateway payment id (for the event payload)
  amountPaidCents?: number;    // guard against short payments
  provider?: "razorpay" | "stripe";
  expectTenantId?: string;     // per-tenant webhook: order must belong to the URL's tenant
}): Promise<{ ok: boolean; orderId?: string; alreadyPaid?: boolean }> {
  const sel = db().from("wa_orders").select("id, tenant_id, phone, cart_id, total_cents, currency, status");
  const { data: order } = m.orderId
    ? await sel.eq("id", m.orderId).maybeSingle()
    : m.paymentRef
      ? await sel.eq("payment_ref", m.paymentRef).maybeSingle()
      : { data: null };
  if (!order) { console.warn("[order paid] no order matched", m.paymentRef ?? m.orderId ?? "(none)"); return { ok: false }; }

  const tenantId = order.tenant_id as string;
  // Defense in depth: a per-tenant webhook (signature verified with tenant X's
  // secret) may only confirm tenant X's orders — never another tenant's.
  if (m.expectTenantId && tenantId !== m.expectTenantId) {
    console.warn(`[order paid] tenant mismatch: order ${order.id} is ${tenantId}, webhook is ${m.expectTenantId}`);
    return { ok: false };
  }
  const orderId = order.id as string;
  const totalCents = (order.total_cents as number) ?? 0;
  if (order.status === "paid" || order.status === "fulfilled") return { ok: true, orderId, alreadyPaid: true };

  // Never confirm on a short payment — leave it pending for reconciliation.
  if (typeof m.amountPaidCents === "number" && m.amountPaidCents < totalCents) {
    console.warn(`[order paid] short payment for ${orderId}: ${m.amountPaidCents} < ${totalCents}`);
    return { ok: false, orderId };
  }

  // Guarded transition — the WHERE status='pending' makes this exactly-once.
  const { data: updated } = await db().from("wa_orders")
    .update({ status: "paid", paid_at: new Date().toISOString(), provider: m.provider ?? null })
    .eq("id", orderId).eq("status", "pending").select("id").maybeSingle();
  if (!updated) return { ok: true, orderId, alreadyPaid: true };   // lost the race → already handled

  if (order.cart_id) await db().from("wa_carts").update({ status: "ordered" }).eq("id", order.cart_id as string).then(() => {}, () => {});

  // Notify the brand + fan out to connected integrations (Slack/Sheets/Zapier).
  void emitEvent(tenantId, "order.paid", { orderId, phone: order.phone, totalCents, provider: m.provider, paymentId: m.providerPaymentId });

  // Best-effort customer confirmation on the SAME WhatsApp number the cart came
  // in on. May fail outside WhatsApp's 24h window — an approved template is the
  // robust follow-up (see COMMERCE-CHECKOUT-FLOW.md #8); the paid status + event
  // above are what actually matter and always run.
  try {
    let creds;
    if (order.cart_id) {
      const { data: cart } = await db().from("wa_carts").select("conversation_id").eq("id", order.cart_id as string).maybeSingle();
      const convId = cart?.conversation_id as string | null | undefined;
      if (convId) {
        const { data: conv } = await db().from("wa_conversations").select("channel_id").eq("id", convId).maybeSingle();
        creds = await credsFor((conv?.channel_id as string | null) ?? undefined, tenantId);
      }
    }
    if (creds) {
      await sendText(order.phone as string, `✅ Payment received — your order #${orderId.slice(0, 8)} is confirmed! We'll follow up with the details shortly.`, creds);
    }
  } catch (e) { console.error("[order paid] confirmation send failed", e); }

  return { ok: true, orderId };
}

// ── Cart recovery (cron) ──────────────────────────────────────────────────────
// Find carts idle for `idleMinutes` and enroll them into the cart_abandoned
// sequence (once). Returns how many recoveries were started.
export async function drainAbandonedCarts(idleMinutes = 60, max = 100): Promise<number> {
  const cutoff = new Date(Date.now() - idleMinutes * 60_000).toISOString();
  const { data } = await db().from("wa_carts")
    .select("id, phone, platform, conversation_id, items, tenant_id")
    .eq("status", "open").eq("recovery_sent", false).lte("updated_at", cutoff).limit(max);

  // Each cart's recovery sequence is its OWN tenant's cart_abandoned sequence.
  const seqByTenant = new Map<string, string | null>();
  const seqIdFor = async (tid: string): Promise<string | null> => {
    if (!seqByTenant.has(tid)) {
      const seq = await getSequenceByTrigger("cart_abandoned", null, tid);
      seqByTenant.set(tid, seq?.id ?? null);
    }
    return seqByTenant.get(tid)!;
  };

  let started = 0;
  for (const c of (data ?? []) as Record<string, unknown>[]) {
    const items = (c.items as CartItem[]) ?? [];
    if (!items.length) continue;
    const tid = (c.tenant_id as string) ?? DEFAULT_TENANT_ID;
    const seqId = await seqIdFor(tid);
    if (!seqId) continue;   // this tenant has no recovery sequence configured
    try {
      await enroll(seqId, { phone: c.phone as string, platform: (c.platform as "whatsapp" | "instagram") ?? "whatsapp", conversationId: (c.conversation_id as string | null) ?? null }, tid);
      await db().from("wa_carts").update({ status: "abandoned", recovery_sent: true, updated_at: new Date().toISOString() }).eq("id", c.id as string);
      started++;
    } catch (e) { console.error("[commerce] cart recovery", e); }
  }
  return started;
}
