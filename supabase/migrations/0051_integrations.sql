-- Integrations framework — per-tenant outbound connections to external systems
-- (webhooks/Zapier/Make/Slack/Teams first; CRMs, Sheets, commerce, scheduling
-- follow on the same table). Each row is ONE connection a tenant configured in
-- their own portal. Secrets (signing secret / API token) are encrypted at rest
-- via crypto.ts before they're written — never plaintext.
--
--   kind         connector type ("webhook", later "google_sheets", "hubspot"…)
--   config       non-secret settings (url, format preset, field maps) as jsonb
--   secret       encrypted (crypto.ts envelope) signing secret / access token
--   events       which platform events this connection subscribes to
--   status       connected | error | unverified  (last verify/delivery result)
--
-- One tenant's bad/broken integration can never affect another: every read and
-- write is tenant-scoped (tdb), and delivery is best-effort + isolated per row.
create table if not exists wa_integrations (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null default '00000000-0000-0000-0000-000000000001',
  kind         text not null,
  name         text not null default '',
  active       boolean not null default true,
  config       jsonb not null default '{}'::jsonb,
  secret       text,
  events       text[] not null default '{}',
  status       text not null default 'unverified',
  status_detail text,
  last_event_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists wa_integrations_tenant_idx on wa_integrations (tenant_id);
create index if not exists wa_integrations_tenant_active_idx on wa_integrations (tenant_id, active);

-- Defense-in-depth: RLS on (service role bypasses; backstops direct REST). See 0037.
alter table wa_integrations enable row level security;
