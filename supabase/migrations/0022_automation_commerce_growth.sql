-- 0020_automation_commerce_growth.sql — the automation core's data foundation.
--
-- One event-driven model: EVENT → TRIGGER → AUTOMATION (Flow or Sequence).
-- This migration adds the three new first-class subsystems that plug into the
-- existing channels / conversations / send layer / cron:
--   • Sequences (drip)         — timed multi-step follow-ups (also powers cart recovery)
--   • Commerce                 — products / carts / orders
--   • Growth tools             — ref links / QR / widgets / opt-in landings
--
-- See AUTOMATION-ARCHITECTURE.md.

-- ── Sequences (drip) ──────────────────────────────────────────────────────────
create table if not exists wa_sequences (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  channel_id    uuid references wa_channels(id) on delete set null,  -- WA or IG channel
  platform      text not null default 'whatsapp' check (platform in ('whatsapp','instagram')),
  trigger_kind  text not null default 'manual'
                  check (trigger_kind in ('manual','keyword','tag_added','opt_in','story_reply','comment','cart_abandoned','order_placed','ad_referral')),
  trigger_value text,                          -- keyword / tag / ref id / story-keyword, etc.
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);
create index if not exists wa_sequences_trigger_idx on wa_sequences (trigger_kind, active);

create table if not exists wa_sequence_steps (
  id           uuid primary key default gen_random_uuid(),
  sequence_id  uuid not null references wa_sequences(id) on delete cascade,
  step_index   int not null,
  delay_minutes int not null default 0,         -- wait from the previous step (or enroll time for step 0)
  action       jsonb not null default '{}',     -- {type:'text'|'template'|'media'|'flow'|'waform'|'product', ...}
  unique (sequence_id, step_index)
);

create table if not exists wa_sequence_enrollments (
  id           uuid primary key default gen_random_uuid(),
  sequence_id  uuid not null references wa_sequences(id) on delete cascade,
  conversation_id uuid references wa_conversations(id) on delete set null,
  phone        text not null,                   -- WA phone OR Instagram IGSID
  platform     text not null default 'whatsapp',
  current_step int not null default 0,
  status       text not null default 'active' check (status in ('active','completed','stopped','failed')),
  next_run_at  timestamptz,                     -- when the current step is due
  last_error   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (sequence_id, phone)                   -- one active enrollment per contact per sequence
);
create index if not exists wa_seq_enroll_due_idx on wa_sequence_enrollments (next_run_at) where status = 'active';

-- ── Commerce ──────────────────────────────────────────────────────────────────
create table if not exists wa_products (
  id              uuid primary key default gen_random_uuid(),
  retailer_id     text,                         -- your SKU / catalog retailer id
  meta_product_id text,                         -- Meta catalog product id (for in-chat product messages)
  catalog_id      text,                         -- Meta catalog id
  name            text not null,
  description     text,
  price_cents     int not null default 0,
  currency        text not null default 'INR',
  image_url       text,
  available       boolean not null default true,
  created_at      timestamptz not null default now()
);

create table if not exists wa_carts (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid references wa_conversations(id) on delete cascade,
  phone           text not null,
  platform        text not null default 'whatsapp',
  status          text not null default 'open' check (status in ('open','abandoned','ordered','expired')),
  items           jsonb not null default '[]',  -- [{product_id, name, qty, price_cents}]
  recovery_sent   boolean not null default false, -- guards one cart-recovery enrollment
  updated_at      timestamptz not null default now(),
  created_at      timestamptz not null default now()
);
create index if not exists wa_carts_abandon_idx on wa_carts (status, updated_at);

create table if not exists wa_orders (
  id           uuid primary key default gen_random_uuid(),
  cart_id      uuid references wa_carts(id) on delete set null,
  phone        text not null,
  items        jsonb not null default '[]',
  total_cents  int not null default 0,
  currency     text not null default 'INR',
  status       text not null default 'pending' check (status in ('pending','paid','fulfilled','cancelled')),
  payment_ref  text,
  created_at   timestamptz not null default now()
);

-- ── Growth tools (lead capture) ───────────────────────────────────────────────
create table if not exists wa_growth_tools (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  kind        text not null check (kind in ('ref_link','qr','widget_popup','widget_bar','landing')),
  slug        text not null unique,             -- public path /g/<slug>
  channel_id  uuid references wa_channels(id) on delete set null,
  prefill     text,                             -- prefilled WA/IG message (the opt-in keyword)
  flow_id     uuid references wa_flows(id) on delete set null,      -- start this flow on opt-in
  sequence_id uuid references wa_sequences(id) on delete set null,  -- or enroll in this sequence
  tag         text,                             -- tag the contact on opt-in
  config      jsonb not null default '{}',      -- widget styling / copy
  clicks      int not null default 0,
  conversions int not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
