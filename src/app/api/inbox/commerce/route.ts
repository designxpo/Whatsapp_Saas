import { NextResponse } from "next/server";
import { apiKeyTenant } from "@/lib/apiauth";
import { listProducts, getOpenCart, upsertCart, checkoutCart, getProduct, type CartItem } from "@/lib/commerce";
import { getConversation } from "@/lib/store";
import { errorMessage } from "@/lib/errors";
import { guardFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// The phone a cart/order hangs off. Instagram chats are keyed by IGSID, so use
// the phone the lead shared — a cart keyed to an IGSID could never be paid.
async function orderPhone(tenantId: string, conversationId?: string | null, phone?: string | null) {
  const direct = (phone ?? "").replace(/\D/g, "");
  if (direct) return direct;
  if (!conversationId) return "";
  const conv = await getConversation(conversationId, tenantId);
  if (!conv) return "";
  if (conv.platform === "whatsapp") return (conv.phone ?? "").replace(/\D/g, "");
  return (conv.leadPhone ?? "").replace(/\D/g, "");
}

// GET /api/inbox/commerce?q=kurta — the catalog, for sending a product mid-chat.
// Also returns the chat's open cart when a conversationId is supplied.
// Auth: Authorization: Bearer <ak_live_… key>.
export async function GET(req: Request) {
  const tenantId = await apiKeyTenant(req);
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const gate = await guardFeature(tenantId, "extension"); if (gate) return gate;
  const sp = new URL(req.url).searchParams;
  const q = (sp.get("q") ?? "").trim().toLowerCase();

  try {
    const all = await listProducts(tenantId);
    const products = (q
      ? all.filter(p => `${p.name} ${p.description ?? ""}`.toLowerCase().includes(q))
      : all
    ).filter(p => p.available).slice(0, 40).map(p => ({
      id: p.id, name: p.name, priceCents: p.priceCents, currency: p.currency,
      imageUrl: p.imageUrl, buttonUrl: p.buttonUrl, description: p.description,
    }));

    let cart = null;
    const phone = await orderPhone(tenantId, sp.get("conversationId"), sp.get("phone"));
    if (phone) {
      const open = await getOpenCart(phone, tenantId).catch(() => null);
      if (open) {
        cart = {
          items: open.items,
          totalCents: open.items.reduce((s, i) => s + i.priceCents * i.qty, 0),
        };
      }
    }
    return NextResponse.json({ products, cart, phone: phone || null });
  } catch (err) {
    return NextResponse.json({ products: [], cart: null, notice: errorMessage(err) });
  }
}

// POST /api/inbox/commerce — build the cart, then turn it into a payment link.
// Body: { conversationId? | phone?, action: "cart",     items: [{ productId, qty }] }
//       { conversationId? | phone?, action: "checkout" }
//
// "checkout" returns the paymentUrl; the panel then SENDS that link as a normal
// message through /api/inbox/reply, so the send stays on one audited path.
export async function POST(req: Request) {
  const tenantId = await apiKeyTenant(req);
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const gate = await guardFeature(tenantId, "extension"); if (gate) return gate;
  let body: { conversationId?: string; phone?: string; action?: string; items?: { productId: string; qty?: number }[] };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  try {
    const phone = await orderPhone(tenantId, body.conversationId, body.phone);
    if (!phone) {
      return NextResponse.json({
        error: "No phone number on this chat yet. An order needs one — ask for it first (Instagram/Facebook chats have no number until the customer shares it).",
      }, { status: 422 });
    }

    if (body.action === "cart") {
      // Prices come from OUR catalog, never the request — a client-supplied
      // price would let anyone pay whatever they liked.
      const items: CartItem[] = [];
      for (const line of body.items ?? []) {
        const p = await getProduct(line.productId, tenantId);
        if (!p) return NextResponse.json({ error: `Product not found: ${line.productId}` }, { status: 400 });
        const qty = Math.max(1, Math.min(99, Math.round(line.qty ?? 1)));
        items.push({ productId: p.id, name: p.name, qty, priceCents: p.priceCents });
      }
      if (!items.length) return NextResponse.json({ error: "items[] required" }, { status: 400 });
      await upsertCart({ phone, conversationId: body.conversationId ?? null, items }, tenantId);
      return NextResponse.json({
        success: true, phone,
        cart: { items, totalCents: items.reduce((s, i) => s + i.priceCents * i.qty, 0) },
      });
    }

    if (body.action === "checkout") {
      const out = await checkoutCart({ phone }, tenantId);
      if (!out) return NextResponse.json({ error: "No open cart for this customer — add a product first." }, { status: 422 });
      if (!out.paymentUrl) {
        return NextResponse.json({
          orderId: out.orderId, totalCents: out.totalCents, paymentUrl: null,
          notice: "Order created, but no payment link — connect Razorpay or Stripe in Integrations to collect payment.",
        });
      }
      return NextResponse.json({ success: true, orderId: out.orderId, totalCents: out.totalCents, paymentUrl: out.paymentUrl });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
