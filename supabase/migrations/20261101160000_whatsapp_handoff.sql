-- 20261101160000_whatsapp_handoff.sql — comments and DMs continue on WhatsApp.
--
-- A comment rule can invite the person to WhatsApp with a personal code: hidden
-- in the wa.me link on Instagram/Facebook, typed (YT-4821) on YouTube, which
-- hides replies with links. When a WhatsApp message carries the code, the
-- handoff is claimed: the business has a real contact, knows which post and
-- comment it came from, and can follow the chat through to a sale.
--
-- Idempotent: safe to run twice.

create table if not exists wa_handoffs (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  code            text not null,
  platform        text not null check (platform in ('instagram', 'facebook', 'youtube')),
  channel_id      uuid references wa_channels(id) on delete set null,
  source_kind     text not null default 'comment' check (source_kind in ('comment', 'dm')),
  source_ref      text,           -- the comment id (or conversation id for a DM)
  post_id         text,           -- the post / media / video
  source_text     text,           -- what they wrote
  source_author   text,
  rule_id         uuid,
  message         text,           -- what to send on WhatsApp when they arrive
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null default now() + interval '30 days',
  claimed_at      timestamptz,
  claimed_phone   text,
  claimed_conversation_id uuid
);

-- A code means one handoff within a workspace.
create unique index if not exists wa_handoffs_code_uq on wa_handoffs (tenant_id, code);
-- The results list: one platform's handoffs, newest first.
create index if not exists wa_handoffs_list_idx on wa_handoffs (tenant_id, platform, created_at desc);

alter table wa_handoffs enable row level security;
drop policy if exists tenant_isolation on wa_handoffs;
create policy tenant_isolation on wa_handoffs
  using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id());

-- The option on each platform's comment rules.
alter table wa_ig_comment_rules add column if not exists wa_handoff boolean not null default false;
alter table wa_ig_comment_rules add column if not exists wa_handoff_message text;
alter table wa_fb_comment_rules add column if not exists wa_handoff boolean not null default false;
alter table wa_fb_comment_rules add column if not exists wa_handoff_message text;
alter table wa_yt_comment_rules add column if not exists wa_handoff boolean not null default false;
alter table wa_yt_comment_rules add column if not exists wa_handoff_message text;
