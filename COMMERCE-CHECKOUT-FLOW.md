# Architecture — In-Chat Add-to-Cart → WhatsApp Pay Link → Order Confirmed

**Goal:** An e-commerce brand's customer browses products in chat, adds them to a cart, and at checkout receives a WhatsApp **pay link**. When they pay, the **order auto-confirms** and a confirmation goes back on WhatsApp — with the brand notified and (optionally) the order pushed to Shopify/Woo/CRM.

> **Key finding:** most of the plumbing is already built. This document maps what exists, the exact gaps, the target architecture, requirements, and a concrete build plan.

---

## 1. The user journey (target)

```
Customer                         Talko AI                         Payment provider        Brand
   │  "show me your bestsellers"    │                                    │                   │
   │ ───────────────────────────►  │  product / productList node        │                   │
   │  ◄─── catalog cards ──────────│  (EXISTS)                          │                   │
   │  taps items → builds cart      │                                    │                   │
   │ ───────────────────────────►  │  addToCart → wa_carts (GAP: capture)│                   │
   │  "checkout"                    │  checkoutCart(): server total,     │                   │
   │                                │  create wa_orders(pending),        │                   │
   │                                │  createPaymentLink() ───────────►  │ hosted pay link   │
   │  ◄── "Pay ₹X here: <link>" ───│  (EXISTS at lib level)             │                   │
   │  opens link, pays  ─────────────────────────────────────────────►  │                   │
   │                                │  ◄── webhook: payment.paid ────────│ (🔴 GAP: build)   │
   │                                │  verify sig → order=paid →         │                   │
   │  ◄── "Order #123 confirmed!" ─│  send confirmation (template) +    │ ── notify ──────► │
   │                                │  post-purchase sequence + push     │                   │
```

---

## 2. What already EXISTS (build on this — don't rebuild)

| Layer | Component | File | Status |
|---|---|---|---|
| **Data model** | `wa_products`, `wa_carts` (open/abandoned/ordered/expired), `wa_orders` (pending/paid/fulfilled/cancelled) | `supabase/migrations/0022_automation_commerce_growth.sql` | ✅ |
| **Catalog** | Product CRUD + import (Shopify/Woo) | `src/lib/commerce.ts`, Catalog tab | ✅ |
| **Cart** | `getOpenCart`, `upsertCart` (jsonb items, abandonment clock) | `commerce.ts:94-113` | ✅ (lib) |
| **Checkout** | `checkoutCart()` — **computes total server-side**, creates order (`pending`), mints pay link, fires `order_placed` sequence + `order.created` event | `commerce.ts:116-142` | ✅ |
| **Pay link** | `createPaymentLink(tenantId, {amountCents, description, phone})` → resolves the tenant's connected **Razorpay/Stripe** and returns a hosted link | `integrations.ts:754`, connectors `:526`/`:559` | ✅ |
| **Flow nodes (display)** | `product` (native catalog card), `productlist`, `carouseltpl`, `buttons`, `message`, `media`, `condition`, `tag`, `template`, `hours`, `handoff`, `end` | `flowengine.ts`, `flows/[id]` editor | ✅ |
| **Partial checkout trigger** | WhatsApp webhook already calls `checkoutCart()` when an address is collected and an open cart exists | `api/webhooks/whatsapp/route.ts:289-291` | ✅ (narrow) |
| **Recovery** | `drainAbandonedCarts()` cron → `cart_abandoned` sequence | `commerce.ts:147`, sequences | ✅ |
| **Channel send** | `sendProduct`, `productCard`, `productList` across WhatsApp/IG/Messenger/webchat | `flowengine.ts:221-278` | ✅ |

---

## 3. The GAPS (what we actually need to build)

### 🔴 GAP 1 — Payment-confirmation webhook (the critical one)
There is **no order-payment webhook**. `api/webhooks/stripe` handles **subscriptions only** (plan/tenant status), and there is **no Razorpay webhook at all**. So today a customer can pay the link and **the order stays `pending` forever** — nothing flips `wa_orders.status → paid`, nothing sends "order confirmed." **This is the #1 build item.**

### 🟠 GAP 2 — Add-to-cart interaction (cart building in chat)
`upsertCart` is only reached today via the address-triggered path. There's no way for a customer to **pick products and build a cart** interactively (no "add to cart" node, no AI function, no handler for Meta's native cart `order` message).

### 🟠 GAP 3 — Commerce flow-builder nodes
The editor can *show* products but has no **"Add to cart"** or **"Checkout / send pay link"** node, so a brand can't assemble the journey without code.

### 🟡 GAP 4 — Order-confirmed messaging + fulfillment
On payment we need to send an **order-confirmation** (a WhatsApp **template**, because payment often lands outside the 24-hour service window), notify the brand, and optionally push the order to Shopify/Woo. Post-purchase `order_placed` sequence exists but isn't triggered by *payment*.

### 🟡 GAP 5 — Pay-link ↔ order reconciliation metadata
`createPaymentLink` isn't passed `orderId`/`tenantId` as provider metadata, so the webhook must reconcile purely by `payment_ref`. Add metadata for robust, tenant-safe matching.

---

## 4. Target architecture

### 4.1 Two paths for cart building (recommend both, phased)

**Path A — WhatsApp-native catalog & cart (Meta Commerce). ← Phase 1, least to build**
Connect a Meta product catalog to the WABA. Meta renders the catalog and the customer builds a cart *natively* in WhatsApp, then sends an **`order` interactive message**. Our webhook receives the line items (`product_retailer_id`, `quantity`, `item_price`), we build `wa_carts`/`wa_orders`, **recompute the total server-side against our own prices** (never trust `item_price`), and mint the pay link. Leverages the existing `product`/`productlist` nodes.

**Path B — Custom cart via buttons / AI function-calling. ← Phase 2, cross-channel**
Drive add-to-cart with quick-reply buttons or an AI tool `addToCart(productId, qty)` / `checkout()`. Works on **Instagram, Messenger, and web chat** too (Meta-native cart is WhatsApp-only). More build, more control.

### 4.2 Payment webhook (both providers) — the core new component

```
POST /api/webhooks/razorpay      POST /api/webhooks/payments/stripe  (order-scoped, separate from the subscription one)
        │                                     │
        ▼                                     ▼
1. Read RAW body, verify signature (fail-closed)
   • Razorpay: HMAC-SHA256(body, RAZORPAY_WEBHOOK_SECRET) == X-Razorpay-Signature
   • Stripe:   stripe.webhooks.constructEvent(body, sig, STRIPE_ORDER_WEBHOOK_SECRET)
2. Idempotency: dedupe on provider event id (store processed ids; ignore repeats)
3. Resolve order: by link/metadata → tenant_id + orderId  (metadata from GAP 5; fallback payment_ref)
4. Guard: order belongs to that tenant; amount_paid == wa_orders.total_cents; currency matches
5. Flip wa_orders.status → 'paid', stamp payment_ref/paid_at   (only if currently 'pending')
6. Side-effects (best-effort, non-blocking):
      • send order-confirmation TEMPLATE on the customer's channel
      • enroll order_placed sequence (already wired) / post-purchase
      • emitEvent('order.paid', …) → Zapier/Sheets/Slack + brand notify
      • optional: push order to Shopify/WooCommerce
7. Return 200 fast (do heavy work async / queued)
```

**Events to subscribe:** Razorpay `payment_link.paid` (+ `payment.captured`); Stripe `checkout.session.completed` / `payment_intent.succeeded` on the order payment links, disambiguated from subscription events by `metadata.kind = "order"`.

### 4.3 State machines (already in the schema — enforce transitions)
- **Cart:** `open → ordered` (checkout) · `open → abandoned` (cron) · `abandoned → open` (returns) · `→ expired`.
- **Order:** `pending → paid` (webhook) → `fulfilled` (brand/Shopify) · `pending → cancelled` (timeout/failed).
Guard every transition (only flip `pending→paid` once; ignore duplicate/late webhooks).

---

## 5. Requirements

### Functional
1. Browse catalog in chat (✅), add/remove items with quantity, view cart, edit, checkout.
2. Server-computed totals (✅ in `checkoutCart`) — **never trust client/Meta-supplied prices**.
3. Mint a hosted pay link on the tenant's own Razorpay/Stripe (✅) and send it on the customer's channel.
4. On payment: confirm the order, message the customer, notify the brand, run post-purchase automation.
5. Abandoned-cart recovery (✅) and failed/expired-payment handling (new).
6. A no-code flow the brand assembles: *catalog → add to cart → checkout → (paid) confirm*.

### Non-functional / security (mostly already satisfied — keep it that way)
- **PCI:** card data never touches our servers — hosted provider pages only. ✅ (keep)
- **Webhook authenticity:** signature-verified, **fail-closed** (matches existing Meta/Stripe pattern). 🔴 build for order webhooks.
- **Idempotency:** exactly-once order fulfillment under retries/duplicate webhooks. 🔴 build.
- **Multi-tenant isolation:** every order/cart/product query scoped to `tenant_id` via `tdb()`; webhook resolves tenant from metadata, never from the client. ✅ pattern exists.
- **WhatsApp 24-hour window:** confirmation after payment likely needs an **approved template** (payment can arrive hours later). 🟠 build/submit template.
- **Consent/opt-in** respected for any post-purchase marketing (✅ opt-out system).
- **Amount/currency validation** against the stored order before marking paid. 🔴 build.

---

## 6. What to build (task list, mapped to files)

| # | Task | Where | Effort |
|---|---|---|---|
| 1 | **Razorpay order webhook** — verify sig, idempotent, reconcile → mark paid → side-effects | `NEW src/app/api/webhooks/razorpay/route.ts` + `src/lib/commerce.ts` (`markOrderPaid`) | M |
| 2 | **Stripe order webhook** (or extend existing, routed by `metadata.kind`) for payment-link/checkout events | `src/app/api/webhooks/stripe/route.ts` or `NEW .../payments/stripe` | M |
| 3 | **Pay-link metadata** — pass `{tenantId, orderId, kind:"order"}` into `createPaymentLink` for both connectors | `commerce.ts:135`, `integrations.ts` connectors | S |
| 4 | **`markOrderPaid(orderId, paymentRef)`** — guarded `pending→paid`, sends confirmation template, enrolls sequence, emits `order.paid`, notifies brand | `src/lib/commerce.ts` | M |
| 5 | **Meta native cart** — handle inbound `order` interactive message → build cart/order (server-repriced) → checkout | `api/webhooks/whatsapp/route.ts` | M |
| 6 | **Flow nodes:** `addToCart`, `viewCart`, `checkout` (send pay link) | `flowengine.ts` + `flows/[id]` editor | M–L |
| 7 | **AI cart tools** (cross-channel): `add_to_cart`, `checkout` function-calling | `src/lib/ai/*`, `commerce.ts` | M |
| 8 | **Order-confirmation WhatsApp template** (submit for Meta approval) | Templates tab | S (+ Meta review lead time) |
| 9 | **Order admin** — orders list, statuses, mark fulfilled, refunds; idempotency/event-log table | Catalog/Orders tab + migration | M |
| 10 | **Failed/expired payment** handling + `order.payment_failed` path | webhook + `commerce.ts` | S |

**Phase 1 (MVP, ~1–2 wks):** #1–#5, #8 → a working WhatsApp catalog→pay→confirm loop on Razorpay.
**Phase 2:** #6, #7, #9 → no-code flow nodes + cross-channel + order admin. **Phase 3:** #10 + fulfillment/Shopify push.

---

## 7. Provider notes
- **Razorpay** (India-first, likely primary): create `payment_links` (✅), then a dashboard webhook → `payment_link.paid`. Verify via `X-Razorpay-Signature` = HMAC-SHA256(body, webhook secret). Supports UPI/cards/netbanking — ideal for the pay-link-on-WhatsApp UX.
- **Stripe:** payment links need an ad-hoc Price (✅ already handled). The **existing** Stripe webhook is subscription-scoped — order events must be routed separately (by `metadata.kind`) so plan billing and order payments don't collide.
- **WhatsApp Pay (India):** optional later; the hosted pay-link approach works today without WhatsApp-native payments and is provider-agnostic.

---

## 8. Edge cases to design for
Partial/short payments · duplicate & out-of-order webhooks (idempotency) · pay link opened after cart edited (lock the order total at checkout — ✅ order snapshots items) · out-of-stock at payment time · currency mismatch · refunds/cancellations · payment link expiry · customer pays twice · abandoned *after* link sent (recovery already covers open carts).

---

*Grounded in the current codebase (`commerce.ts`, `integrations.ts`, `flowengine.ts`, migration 0022, the webhook routes). The heavy lifting — schema, cart, server-side totals, pay-link minting, sequences, catalog — already exists; the build is the payment-confirmation webhook, the cart-building UX, and the no-code flow nodes.*
