# Automation Core — architecture to beat ManyChat

The 5 gaps (story-reply, e-commerce, drip sequences, growth widgets, WhatsApp
Flows) are **not** five separate features. They are all instances of one idea:

> **an EVENT fires → a TRIGGER matches → an AUTOMATION runs (against a contact).**

So we build ONE event-driven core and let every feature plug into it. That's
what makes it stronger than ManyChat (where these are bolted-on silos).

```
            EVENTS                    TRIGGERS                 AUTOMATIONS
  ┌────────────────────────┐                          ┌────────────────────────┐
  │ inbound_message        │                          │ Flow   (branching,      │
  │ keyword                │     trigger_kind +        │         real-time)      │
  │ comment   (IG/FB)      │──▶  trigger_value  ──────▶│ Sequence (drip, timed)  │
  │ story_reply (IG)       │     → resolves to one     │ Single send / template  │
  │ opt_in (growth widget) │       automation          │ AI reply (RAG)          │
  │ ad_referral (CTWA)     │                          └────────────────────────┘
  │ cart_abandoned         │                                    │
  │ order_placed           │                          executes via the shared
  │ schedule_tick (cron)   │                          SEND layer (WA + IG, with
  └────────────────────────┘                          the 24h-window guard)
```

## Shared spine (already exists — reuse, don't rebuild)
- **Channels** (`wa_channels`) — WhatsApp + Instagram creds, per channel.
- **Conversations** (`wa_conversations`) — `platform`, `last_inbound_at` (the
  24-hour window source of truth).
- **Send layer** — `whatsapp.ts` (text/template/media/buttons/list/product) and
  `instagram.ts` (window-guarded). Every automation sends through these.
- **Flow engine** (`flowengine.ts`) — branching real-time automations.
- **Cron** (`/api/cron/process-queue`) — already drains queues/reminders; we add
  sequence + cart-recovery draining here.

## New first-class concepts

### 1. Sequences (drip) — `lib/sequences.ts`
Time-based, multi-step automations. The backbone for follow-ups AND cart
recovery AND post-purchase nurture.
- `wa_sequences` (trigger_kind + value, channel), `wa_sequence_steps`
  (delay_minutes + action json), `wa_sequence_enrollments` (per contact:
  current_step, next_run_at, status).
- Enrollment is created by ANY event (keyword, opt-in, story_reply, tag,
  cart_abandoned…). The cron advances due enrollments.
- **Compliance**: on Instagram, drip steps only fire inside the 24h window
  (enforced by `instagram.ts`). On WhatsApp, outside-window steps must use an
  approved **template** (the send layer already supports this). The engine
  picks the right send per step `action.type`.

### 2. Commerce — `lib/commerce.ts`
- `wa_products` (catalog; mirrors Meta catalog ids), `wa_carts` (open/abandoned/
  ordered), `wa_orders` (pending/paid/fulfilled).
- In-chat browse via `sendProduct`/`sendProductList` (exist) and checkout via a
  **WhatsApp Flow** (multi-screen). 
- **Cart recovery = a Sequence** triggered by the `cart_abandoned` event (a cart
  with no activity for N minutes, emitted by the cron). No separate subsystem.

### 3. Growth tools — `lib/growth.ts` + `/g/[slug]`
- `wa_growth_tools` (ref_link | qr | widget_popup | widget_bar | landing) each
  with a slug, prefilled opt-in, and an action (start flow / enroll sequence /
  tag). 
- A public `/g/[slug]` route redirects to `wa.me`/IG with the prefill and emits
  the `opt_in` event → trigger → automation. Click/conversion counters built in.
- Embeddable `<script>` widget for popups/bars on any site.

### 4. WhatsApp Flows (extend `waforms.ts`) — parity + beyond
- Today: single-screen forms (`buildFlowJson`, create/publish/send). 
- Extend to **multi-screen** flows (lead-qual → date-pick → confirm) and a
  **catalog/checkout** flow used by commerce. Same Meta Flows API.

## Why this beats ManyChat
- **One automation graph** spanning WhatsApp **and** Instagram (and later
  Messenger/TikTok) — not per-channel silos.
- **Real grounded AI (RAG)** as a first-class automation action, not a $29
  single-step add-on.
- **Commerce + cart-recovery reuse the sequence engine** — less surface area,
  fewer bugs, faster to extend.
- **Compliance enforced in the core** (24h window, no cold DM) so scaling never
  risks bans — the thing that gets ManyChat users' accounts flagged.

## Build phases
1. ✅ Schema foundation (this migration: sequences + commerce + growth).
2. ✅ Sequence engine + cron draining.
3. ✅ Story-reply trigger (IG) → flow/sequence.
4. ⬜ Commerce engine (cart lifecycle + cart_abandoned event + recovery seq).
5. ⬜ Growth `/g/[slug]` + embeddable widget.
6. ⬜ Multi-screen WhatsApp Flows + checkout flow.
7. ⬜ Builder UI for sequences, catalog, growth tools.
