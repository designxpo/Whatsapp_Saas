-- ── Multi-number / multi-WABA channels ────────────────────────────────────────
-- Each row is one WhatsApp number the portal can send/receive on. Inbound
-- webhooks route by phone_number_id (Meta includes it in every event), and
-- conversations remember their channel so replies, AI, and flows answer from
-- the same number. When this table is empty the portal falls back to the
-- META_WA_* env credentials (single-number mode) — nothing breaks.

create table if not exists wa_channels (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,                 -- label shown in the portal, e.g. "Sales IN"
  phone_number_id  text not null unique,          -- Meta Phone Number ID
  waba_id          text not null,                 -- WhatsApp Business Account ID
  access_token     text not null,                 -- system-user token with access to this WABA
  app_id           text,                          -- Meta App ID (template sample uploads)
  agent_id         uuid references wa_ai_agents(id) on delete set null,  -- default AI persona for this number
  active           boolean not null default true,
  is_default       boolean not null default false, -- used when a send has no explicit channel
  created_at       timestamptz not null default now()
);

-- Which number a conversation lives on (replies must come from the same number).
alter table wa_conversations add column if not exists channel_id uuid references wa_channels(id) on delete set null;

-- Which number a campaign sends from.
alter table wa_campaigns add column if not exists channel_id uuid references wa_channels(id) on delete set null;

-- Scope a chatbot flow to one number (null = runs on every number).
alter table wa_flows add column if not exists channel_id uuid references wa_channels(id) on delete set null;

-- Which number an API rule sends from.
alter table wa_api_rules add column if not exists channel_id uuid references wa_channels(id) on delete set null;
