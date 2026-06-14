// Commerce — products, carts, orders. Cart RECOVERY is not a bespoke feature:
// it's a Sequence (trigger_kind='cart_abandoned') that the cron enrolls idle
// carts into. Browse/checkout reuse the WhatsApp product messages + Flows.

import { db } from "./supabase";
import { getSequenceByTrigger, enroll } from "./sequences";

export interface CartItem { productId: string; name: string; qty: number; priceCents: number }
export interface Product { id: string; name: string; description: string | null; priceCents: number; currency: string; imageUrl: string | null; retailerId: string | null; metaProductId: string | null; catalogId: string | null; available: boolean }

function mapProduct(r: Record<string, unknown>): Product {
  return {
    id: r.id as string, name: r.name as string, description: (r.description as string | null) ?? null,
    priceCents: (r.price_cents as number) ?? 0, currency: (r.currency as string) ?? "INR",
    imageUrl: (r.image_url as string | null) ?? null, retailerId: (r.retailer_id as string | null) ?? null,
    metaProductId: (r.meta_product_id as string | null) ?? null, catalogId: (r.catalog_id as string | null) ?? null,
    available: (r.available as boolean) ?? true,
  };
}

// ── Products ──────────────────────────────────────────────────────────────────
export async function listProducts(): Promise<Product[]> {
  const { data } = await db().from("wa_products").select("*").order("created_at", { ascending: false });
  return (data ?? []).map(r => mapProduct(r as Record<string, unknown>));
}

export async function saveProduct(p: Partial<Product> & { name: string }): Promise<Product> {
  const row = {
    name: p.name.trim(), description: p.description ?? null, price_cents: p.priceCents ?? 0,
    currency: p.currency ?? "INR", image_url: p.imageUrl ?? null, retailer_id: p.retailerId ?? null,
    meta_product_id: p.metaProductId ?? null, catalog_id: p.catalogId ?? null, available: p.available ?? true,
  };
  const q = p.id ? db().from("wa_products").update(row).eq("id", p.id).select().single()
                 : db().from("wa_products").insert(row).select().single();
  const { data, error } = await q;
  if (error) throw error;
  return mapProduct(data as Record<string, unknown>);
}

export async function deleteProduct(id: string): Promise<void> {
  await db().from("wa_products").delete().eq("id", id);
}

// ── Carts ─────────────────────────────────────────────────────────────────────
export async function getOpenCart(phone: string): Promise<{ id: string; items: CartItem[] } | null> {
  const { data } = await db().from("wa_carts").select("id, items").eq("phone", phone).eq("status", "open").maybeSingle();
  return data ? { id: data.id as string, items: (data.items as CartItem[]) ?? [] } : null;
}

// Create/replace the open cart for a contact (resets the abandonment clock).
export async function upsertCart(p: { phone: string; platform?: "whatsapp" | "instagram"; conversationId?: string | null; items: CartItem[] }): Promise<string> {
  const existing = await getOpenCart(p.phone);
  const now = new Date().toISOString();
  if (existing) {
    await db().from("wa_carts").update({ items: p.items, recovery_sent: false, updated_at: now }).eq("id", existing.id);
    return existing.id;
  }
  const { data, error } = await db().from("wa_carts").insert({
    phone: p.phone, platform: p.platform ?? "whatsapp", conversation_id: p.conversationId ?? null,
    items: p.items, status: "open",
  }).select("id").single();
  if (error) throw error;
  return data!.id as string;
}

// Convert an open cart into an order.
export async function checkoutCart(p: { phone: string; paymentRef?: string }): Promise<{ orderId: string } | null> {
  const cart = await getOpenCart(p.phone);
  if (!cart) return null;
  const total = cart.items.reduce((s, i) => s + i.priceCents * i.qty, 0);
  const { data, error } = await db().from("wa_orders").insert({
    cart_id: cart.id, phone: p.phone, items: cart.items, total_cents: total, status: p.paymentRef ? "paid" : "pending", payment_ref: p.paymentRef ?? null,
  }).select("id").single();
  if (error) throw error;
  await db().from("wa_carts").update({ status: "ordered", updated_at: new Date().toISOString() }).eq("id", cart.id);
  // Fire the order_placed event → optional post-purchase sequence.
  const seq = await getSequenceByTrigger("order_placed");
  if (seq) await enroll(seq.id, { phone: p.phone, platform: "whatsapp" });
  return { orderId: data!.id as string };
}

// ── Cart recovery (cron) ──────────────────────────────────────────────────────
// Find carts idle for `idleMinutes` and enroll them into the cart_abandoned
// sequence (once). Returns how many recoveries were started.
export async function drainAbandonedCarts(idleMinutes = 60, max = 100): Promise<number> {
  const seq = await getSequenceByTrigger("cart_abandoned");
  if (!seq) return 0;   // no recovery sequence configured → nothing to do
  const cutoff = new Date(Date.now() - idleMinutes * 60_000).toISOString();
  const { data } = await db().from("wa_carts")
    .select("id, phone, platform, conversation_id, items")
    .eq("status", "open").eq("recovery_sent", false).lte("updated_at", cutoff).limit(max);

  let started = 0;
  for (const c of (data ?? []) as Record<string, unknown>[]) {
    const items = (c.items as CartItem[]) ?? [];
    if (!items.length) continue;
    try {
      await enroll(seq.id, { phone: c.phone as string, platform: (c.platform as "whatsapp" | "instagram") ?? "whatsapp", conversationId: (c.conversation_id as string | null) ?? null });
      await db().from("wa_carts").update({ status: "abandoned", recovery_sent: true, updated_at: new Date().toISOString() }).eq("id", c.id as string);
      started++;
    } catch (e) { console.error("[commerce] cart recovery", e); }
  }
  return started;
}
