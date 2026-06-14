-- 0019_tenancy.sql — Multi-tenant foundation (shared DB + Postgres RLS).
--
-- Strategy: every tenant-owned table gets a `tenant_id`, an FK to `tenants`,
-- an index, and a row-level-security policy keyed on a per-request GUC
-- (`app.tenant_id`). All existing single-tenant data is backfilled to one
-- default tenant so nothing breaks on upgrade.
--
-- IMPORTANT — enforcement model:
--   The app currently connects with Supabase's SERVICE ROLE, which has the
--   BYPASSRLS attribute, so these RLS policies are NOT enforced for it.
--   Enforcement at runtime is APPLICATION-LAYER (see src/lib/tenantdb.ts —
--   every query is scoped by tenant_id). The RLS policies below are a
--   defense-in-depth backstop that DOES apply the moment any non-superuser
--   role (PostgREST `authenticated`/`anon`, a future read-replica role, or a
--   direct psql session that has run `SET app.tenant_id`) touches the data.

create extension if not exists pgcrypto;

-- ── Tenants ──────────────────────────────────────────────────────────────────
create table if not exists tenants (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text unique not null,                 -- subdomain / path segment
  status      text not null default 'active',       -- active | suspended | trialing
  plan        text not null default 'trial',        -- trial | starter | growth | scale
  created_at  timestamptz not null default now()
);

-- The default tenant inherits all pre-existing single-tenant rows.
insert into tenants (id, name, slug, plan, status)
values ('00000000-0000-0000-0000-000000000001', 'Default', 'default', 'scale', 'active')
on conflict (id) do nothing;

-- Helper used by RLS policies (NULL-safe: returns NULL when GUC unset).
create or replace function current_tenant_id() returns uuid
language sql stable as $$
  select nullif(current_setting('app.tenant_id', true), '')::uuid
$$;

-- ── Retrofit every tenant-owned table ────────────────────────────────────────
do $$
declare
  t text;
  tbls text[] := array[
    'contacts','kb_chunks','kb_documents','wa_activity_log','wa_ad_campaign_map',
    'wa_ad_drafts','wa_ad_flow_triggers','wa_ad_rules','wa_ai_agents','wa_ai_functions',
    'wa_ai_prompts','wa_api_rules','wa_campaigns','wa_channels','wa_conv_messages',
    'wa_conversations','wa_flow_sessions','wa_flows','wa_links','wa_optouts',
    'wa_portal_campaigns','wa_quick_replies','wa_router_events','wa_rule_sends',
    'wa_scheduled_sends','wa_semantic_cache','wa_send_log','wa_send_queue',
    'wa_settings','wa_template_meta','wa_users'
  ];
begin
  foreach t in array tbls loop
    -- skip tables that don't exist in this DB (defensive across environments)
    if to_regclass(t) is null then
      raise notice 'skip %, not present', t;
      continue;
    end if;

    -- 1. add column (nullable first so backfill can run)
    execute format('alter table %I add column if not exists tenant_id uuid', t);
    -- 2. backfill existing rows to the default tenant
    execute format('update %I set tenant_id = %L where tenant_id is null',
                   t, '00000000-0000-0000-0000-000000000001');
    -- 3. enforce presence + default for new rows
    execute format('alter table %I alter column tenant_id set not null', t);
    execute format('alter table %I alter column tenant_id set default %L',
                   t, '00000000-0000-0000-0000-000000000001');
    -- 4. FK (drop-then-add so the migration is idempotent)
    execute format('alter table %I drop constraint if exists %I', t, t || '_tenant_fk');
    execute format('alter table %I add constraint %I foreign key (tenant_id) references tenants(id) on delete cascade',
                   t, t || '_tenant_fk');
    -- 5. index for tenant-scoped scans
    execute format('create index if not exists %I on %I (tenant_id)', t || '_tenant_idx', t);
    -- 6. RLS + isolation policy (backstop; see header note)
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists tenant_isolation on %I', t);
    execute format($p$create policy tenant_isolation on %I
        using (tenant_id = current_tenant_id())
        with check (tenant_id = current_tenant_id())$p$, t);
  end loop;
end $$;

-- Once every tenant has its own row, wa_settings is per-tenant config rather
-- than a global KV. (No schema change beyond tenant_id; semantics shift only.)
