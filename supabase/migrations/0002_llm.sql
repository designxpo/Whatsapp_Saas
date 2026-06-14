-- Two-way conversations + message log for the AI auto-reply assistant.

-- ── Conversations (one per contact we're talking with) ───────────────────────
create table if not exists wa_conversations (
  id               uuid primary key default gen_random_uuid(),
  phone            text not null unique,            -- digits, country-coded
  contact_id       uuid references contacts(id) on delete set null,
  name             text not null default '',        -- WA profile name / contact name
  status           text not null default 'active'
                     check (status in ('active','paused','escalated')),
  bot_enabled      boolean not null default true,   -- per-conversation kill switch
  last_message     text,                            -- snippet for inbox list
  last_inbound_at  timestamptz,                     -- drives 24h-window checks
  last_outbound_at timestamptz,
  needs_reply      boolean not null default false,  -- set on inbound, cleared on reply
  created_at       timestamptz not null default now()
);
create index if not exists wa_conv_status_idx on wa_conversations (status);
create index if not exists wa_conv_needs_reply_idx on wa_conversations (needs_reply) where needs_reply;

-- ── Messages (append-only; conversation memory for the LLM) ───────────────────
create table if not exists wa_conv_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references wa_conversations(id) on delete cascade,
  role            text not null check (role in ('user','assistant')),
  body            text not null default '',
  meta_message_id text,                             -- WA id (inbound or outbound)
  source          text not null default 'bot'       -- 'inbound' | 'bot' | 'agent'
                    check (source in ('inbound','bot','agent')),
  created_at      timestamptz not null default now()
);
create index if not exists wa_cm_conv_idx on wa_conv_messages (conversation_id, created_at);
-- Idempotency: a Meta message id is logged at most once (webhook retries).
create unique index if not exists wa_cm_metaid_idx on wa_conv_messages (meta_message_id)
  where meta_message_id is not null;
