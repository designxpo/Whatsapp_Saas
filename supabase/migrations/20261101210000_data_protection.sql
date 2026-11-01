-- 20261101210000_data_protection.sql — router events per workspace, proof of
-- Meta deletion requests, and the indexes the retention stage reads by.
--
-- The app works before this is applied (every write below falls back when a
-- column is missing); this makes the new behaviour complete and fast.
--
-- Idempotent: safe to run twice. Each block skips a table this database
-- doesn't have yet.

-- ── 1. wa_router_events.tenant_id ─────────────────────────────────────────────
-- 0019 already gave this table tenant_id (NOT NULL, default = the Default
-- workspace, cascading FK), but logRouterEvent never set it — so every
-- workspace's routing events, with its customers' questions and phone numbers,
-- were filed under the Default workspace: they never left with a deleted
-- workspace and showed up in the owner's KB test set. The code now writes it.
-- The column is (re)declared here only for a database that skipped 0019.
do $$
begin
  if to_regclass('public.wa_router_events') is null then return; end if;
  alter table wa_router_events add column if not exists tenant_id uuid references tenants(id) on delete cascade;
  create index if not exists wa_router_events_tenant_created_idx on wa_router_events (tenant_id, created_at desc);

  -- Re-file past events where the phone belongs to exactly ONE workspace. A
  -- phone that two workspaces both talk to is ambiguous and stays as it was;
  -- the retention stage ages those out within 180 days anyway.
  update wa_router_events e
     set tenant_id = o.tenant_id
    from (
      select phone, (array_agg(distinct tenant_id))[1] as tenant_id
        from wa_conversations
       group by phone
      having count(distinct tenant_id) = 1
    ) o
   where e.phone = o.phone
     and e.tenant_id is distinct from o.tenant_id;
end $$;

-- ── 2. meta_deletion_requests.detail ──────────────────────────────────────────
-- What a processed request did — counts only, never the person's data:
-- "workspaces=1 rows=42 channels=0". The status page shows status/dates; this
-- is the operator's proof of what was erased.
do $$
begin
  if to_regclass('public.meta_deletion_requests') is null then return; end if;
  alter table meta_deletion_requests add column if not exists detail text;
  -- The engine retries unfinished requests; retention ages out old completed ones.
  create index if not exists meta_deletion_requests_status_idx on meta_deletion_requests (status, created_at);
  create index if not exists meta_deletion_requests_completed_idx on meta_deletion_requests (completed_at) where completed_at is not null;
end $$;

-- ── 3. Indexes for the retention stage (src/lib/retention.ts) ─────────────────
-- Each rule reads "rows older than X" across all workspaces, a page at a time.
do $$
begin
  if to_regclass('public.wa_session_refs') is not null then
    create index if not exists wa_session_refs_created_idx on wa_session_refs (created_at);
  end if;
  if to_regclass('public.wa_semantic_cache') is not null then
    create index if not exists wa_semantic_cache_last_used_idx on wa_semantic_cache (last_used_at);
  end if;
  if to_regclass('public.wa_ai_gaps') is not null then
    create index if not exists wa_ai_gaps_resolved_idx on wa_ai_gaps (resolved_at) where resolved_at is not null;
    create index if not exists wa_ai_gaps_created_idx on wa_ai_gaps (created_at) where resolved_at is null;
  end if;
  if to_regclass('public.wa_inbound_events') is not null then
    create index if not exists wa_inbound_events_created_idx on wa_inbound_events (created_at);
  end if;
  -- wa_email_log is read by sent_at, already indexed (0114); wa_router_events
  -- by created_at, already indexed (0005).
end $$;
