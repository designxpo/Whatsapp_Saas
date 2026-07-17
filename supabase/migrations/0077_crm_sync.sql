-- ── CRM sync queue — bulletproof LeadSquared activity logging (multi-tenant) ──
-- Every timeline push used to be fire-and-forget: an LSQ outage, rate limit,
-- expired key, or a killed serverless invocation lost the activity forever, with
-- only a console line as evidence. Now a push that fails RETRIABLY (network,
-- 401/403/408/429/5xx) is parked here and replayed by the per-minute cron with
-- exponential backoff; once the tenant's keys/outage are fixed the backlog syncs
-- itself. Rows either replay successfully (deleted) or die loudly (status
-- 'dead' with the last error) after the attempt cap.
--
-- payload is the exact pushWaActivity/pushChatActivity argument object
-- (including tenantId — the replay resolves that tenant's LSQ credentials);
-- kind says which function replays it. Campaign blasts enqueue directly (never
-- immediate) so a large send can't stampede LSQ's API rate limits.
--
-- Additive + idempotent.

create table if not exists wa_crm_sync (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null default '00000000-0000-0000-0000-000000000001' references tenants(id) on delete cascade,
  kind            text not null,                          -- 'wa' | 'chat'
  payload         jsonb not null,                         -- pushWaActivity / pushChatActivity args
  attempts        int not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error      text,
  status          text not null default 'pending',        -- pending | dead
  created_at      timestamptz not null default now()
);

create index if not exists wa_crm_sync_due on wa_crm_sync (status, next_attempt_at);

comment on table wa_crm_sync is
  'Retry queue for LeadSquared timeline pushes. Failed-retriable pushes park here; the cron replays with backoff, deletes on success, dead-letters after the cap.';

-- Deny-by-default for the public anon/authenticated PostgREST roles (the app
-- uses the service role, which bypasses RLS) — same backstop as 0037.
alter table wa_crm_sync enable row level security;
