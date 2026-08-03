-- ── CRM session batching — combine a WhatsApp/chat conversation's messages ────
-- into ONE LeadSquared activity instead of one per message (multi-tenant).
-- Every inbound/outbound message used to post its own timeline note
-- immediately — a normal multi-question qualification flow left a lead's LSQ
-- timeline as 10-20 tiny entries instead of one readable conversation. Now
-- each message is buffered here (keyed by tenant+kind+phone+channel) and
-- flushCrmSessions (per-minute/5-min cron) posts everything accumulated as ONE
-- note once the session has gone quiet for LSQ_SESSION_GAP_MINUTES (default
-- 10) with no new message.
--
-- Additive + idempotent.

create table if not exists wa_crm_session (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null default '00000000-0000-0000-0000-000000000001' references tenants(id) on delete cascade,
  kind            text not null,                          -- 'wa' | 'chat'
  phone           text not null,                           -- digits-only; or "handle:<h>" for a phone-less IG lead
  channel         text not null default '',                -- '' for wa; "Instagram" | "Messenger" | "Web chat" for chat
  lead_id         text not null,
  lines           jsonb not null default '[]'::jsonb,
  attempts        int not null default 0,
  last_message_at timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  unique (tenant_id, kind, phone, channel)
);

create index if not exists wa_crm_session_due on wa_crm_session (last_message_at);

comment on table wa_crm_session is
  'Buffers WhatsApp/chat messages per lead session; flushCrmSessions combines them into one LeadSquared activity once the session goes quiet.';

-- Deny-by-default for the public anon/authenticated PostgREST roles (the app
-- uses the service role, which bypasses RLS) — same backstop as 0077.
alter table wa_crm_session enable row level security;
