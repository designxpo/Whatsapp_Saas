-- Saved AI ad-builder chat sessions — the "chat history" sidebar. Each row is one
-- conversation with the AI campaign builder (its messages + the last drafted
-- plan), so a tenant can reopen or delete past sessions across devices/browsers.
-- Additive + idempotent.
create table if not exists wa_ad_chat_sessions (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null default '00000000-0000-0000-0000-000000000001' references tenants(id) on delete cascade,
  title       text not null default 'New campaign chat',
  messages    jsonb not null default '[]'::jsonb,     -- [{ role, content, doc? }]
  plan        jsonb,                                   -- last drafted AdPlan (nullable)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists wa_ad_chat_sessions_tenant_updated_idx
  on wa_ad_chat_sessions (tenant_id, updated_at desc);

comment on table wa_ad_chat_sessions is
  'AI ad-builder chat history — one row per saved conversation (messages + last drafted plan), tenant-scoped.';

-- Service role bypasses RLS; deny-by-default for the public anon/authenticated
-- PostgREST roles (backstop — the app never uses them here).
alter table wa_ad_chat_sessions enable row level security;
