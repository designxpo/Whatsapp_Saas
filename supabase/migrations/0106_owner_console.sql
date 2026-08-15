-- 0106_owner_console.sql — make the owner portal answerable at fleet scale.
--
-- Until now every platform number was a JS loop over every tenant row, and the
-- tenants table had no index on any column an operator filters by (only the two
-- partial Stripe-id indexes from 0028). That is why /api/owner/tenants cost
-- ~1+5N round-trips and /api/owner/health ~1+8N: the work had nowhere to happen
-- but in the request. Worse, those unbounded selects sit under PostgREST's
-- max_rows, so past that ceiling they TRUNCATE silently rather than fail — the
-- console would show confident, wrong totals.
--
-- Three things here: indexes so the live columns are queryable, a denormalised
-- tenant_metrics row for the signals that are expensive to derive, and SQL
-- aggregates so counts happen in the database instead of in JavaScript.
--
-- Deliberately NOT denormalised: status, payment_status, plan, trial_ends_at,
-- amount_cents, created_at. Those live on `tenants`, are authoritative, and once
-- indexed answer instantly — so every revenue and lifecycle queue reads them
-- directly and can never be stale. Only the derived signals (channel health, KB,
-- integrations, activity) go in tenant_metrics, where hours of staleness is fine
-- and every screen shows an explicit "as of".

-- ── 1) Indexes on the live columns every queue and sort touches ───────────────
-- Note: no CONCURRENTLY, matching 0040's precedent (these run inside the
-- migration transaction; the table is small today and this is a one-off).
create index if not exists tenants_status_idx         on tenants (status);
create index if not exists tenants_payment_status_idx on tenants (payment_status);
create index if not exists tenants_plan_idx           on tenants (plan);
create index if not exists tenants_created_idx        on tenants (created_at desc);
-- Partial: only rows that actually have a trial are ever scanned for one.
create index if not exists tenants_trial_ends_idx     on tenants (trial_ends_at)
  where trial_ends_at is not null;
-- Keyset pagination sorts on (created_at desc, id) — the tiebreaker keeps the
-- cursor stable when several tenants share a timestamp.
create index if not exists tenants_keyset_idx         on tenants (created_at desc, id desc);

-- Operator search: "find this account by whatever the customer told me".
-- Trigram so an infix match (a fragment of a company name, a domain out of an
-- email) uses the index instead of a full scan.
create extension if not exists pg_trgm;
create index if not exists tenants_company_trgm_idx on tenants using gin (lower(company)     gin_trgm_ops);
create index if not exists tenants_email_trgm_idx   on tenants using gin (lower(owner_email) gin_trgm_ops);
create index if not exists tenants_name_trgm_idx    on tenants using gin (lower(name)        gin_trgm_ops);

-- ── 2) Audit log: filterable, not just newest-N ───────────────────────────────
-- 0024 indexed created_at only, so every filtered read was a scan and the UI
-- compensated by fetching 40 rows and filtering in JS — which silently loses a
-- plan-change request as soon as 40 newer rows exist.
create index if not exists wa_owner_audit_tenant_idx on wa_owner_audit (tenant_id, created_at desc);
create index if not exists wa_owner_audit_action_idx on wa_owner_audit (action, created_at desc);
create index if not exists wa_owner_audit_actor_idx  on wa_owner_audit (actor_email, created_at desc);

-- ── 3) tenant_metrics — the derived signals, refreshed on a rotation ──────────
-- One row per tenant. Written by the /api/cron/tenant-metrics sweep (oldest
-- refreshed_at first) and, for WhatsApp quality, write-through from
-- recordChannelQuality() so a number going RED surfaces in seconds.
create table if not exists tenant_metrics (
  tenant_id            uuid primary key references tenants(id) on delete cascade,
  contacts             int         not null default 0,
  conversations_30d    int         not null default 0,
  messages_30d         int         not null default 0,
  channels             int         not null default 0,
  channels_receiving   int         not null default 0,   -- channels with inbound traffic in 7d
  last_inbound_at      timestamptz,
  wa_quality           text,                             -- GREEN | YELLOW | RED | UNKNOWN
  wa_health            text,                             -- AVAILABLE | FLAGGED | RESTRICTED
  marketing_paused     boolean     not null default false,
  ai_configured        boolean     not null default false,
  kb_ready             int         not null default 0,
  kb_total             int         not null default 0,
  integrations_active  int         not null default 0,
  integrations_errored int         not null default 0,
  health               text        not null default 'ok',-- ok | warn | error
  usage_pct_max        int         not null default 0,   -- highest resource utilisation, drives the upsell queue
  refreshed_at         timestamptz not null default now()
);

-- Every index here backs one queue predicate.
create index if not exists tenant_metrics_health_idx      on tenant_metrics (health) where health <> 'ok';
create index if not exists tenant_metrics_quality_idx     on tenant_metrics (wa_quality) where wa_quality in ('RED','YELLOW');
create index if not exists tenant_metrics_errored_idx     on tenant_metrics (integrations_errored) where integrations_errored > 0;
create index if not exists tenant_metrics_last_inbound_idx on tenant_metrics (last_inbound_at);
create index if not exists tenant_metrics_usage_idx       on tenant_metrics (usage_pct_max) where usage_pct_max >= 80;
-- The sweep claims work by "least recently refreshed".
create index if not exists tenant_metrics_refreshed_idx   on tenant_metrics (refreshed_at);

-- Backfill a placeholder row per tenant so a LEFT JOIN never has to special-case
-- absence, and so the sweep has something to order by from the first tick.
insert into tenant_metrics (tenant_id, refreshed_at)
select id, 'epoch'::timestamptz from tenants
on conflict (tenant_id) do nothing;

-- Self-healing: give any tenant without a metrics row one, at epoch so the
-- rotation picks it up first. Called every sweep tick, so a tenant created by a
-- path that forgot to seed a row is still reached — one round-trip, and it can
-- never drift the way a remembered call site can.
create or replace function owner_backfill_metrics()
returns integer language sql volatile as $$
  with inserted as (
    insert into tenant_metrics (tenant_id, refreshed_at)
    select t.id, 'epoch'::timestamptz from tenants t
    where not exists (select 1 from tenant_metrics m where m.tenant_id = t.id)
    returning 1
  ) select count(*)::int from inserted;
$$;

-- ── 4) Aggregates — counting moves into the database ──────────────────────────

-- Headline counters + MRR in one round-trip. Replaces platformStats()'s
-- select-every-row-then-loop-in-JS.
create or replace function owner_platform_stats()
returns table (total bigint, active bigint, trialing bigint, suspended bigint, mrr_cents bigint)
language sql stable as $$
  select
    count(*),
    count(*) filter (where status not in ('suspended','cancelled')
                       and status <> 'trialing' and payment_status <> 'trialing'),
    count(*) filter (where status not in ('suspended','cancelled')
                       and (status = 'trialing' or payment_status = 'trialing')),
    count(*) filter (where status in ('suspended','cancelled')),
    coalesce(sum(amount_cents) filter (where payment_status = 'active'), 0)
  from tenants;
$$;

create or replace function owner_plan_mix()
returns table (plan text, count bigint)
language sql stable as $$
  select plan, count(*) from tenants group by plan order by count(*) desc;
$$;

-- Signup histogram over a bounded window — the JS version scanned all-time rows
-- to build a 30-day series.
create or replace function owner_signups_by_day(p_days int default 30)
returns table (day date, count bigint)
language sql stable as $$
  select created_at::date, count(*)
  from tenants
  where created_at >= (now() - make_interval(days => p_days))
  group by 1 order by 1;
$$;

-- Every work-queue count in ONE round-trip. The queue keys here are the contract
-- the console's Today screen renders and the tenant list filters by — keep them
-- in sync with QUEUES in src/lib/ownerqueues.ts.
create or replace function owner_queue_counts()
returns table (queue text, count bigint, oldest timestamptz)
language sql stable as $$
  -- Revenue at risk — read live off tenants, never stale.
  select 'payment_failed', count(*), min(created_at)
    from tenants where payment_status = 'past_due'
  union all
  select 'suspended', count(*), min(created_at)
    from tenants where status = 'suspended'
  union all
  select 'trial_ending', count(*), min(trial_ends_at)
    from tenants
   where trial_ends_at between now() and now() + interval '3 days'
     and payment_status in ('trialing','none')
  union all
  select 'trial_expired', count(*), min(trial_ends_at)
    from tenants
   where trial_ends_at < now() and payment_status in ('trialing','none')
     and status not in ('suspended','cancelled')
  -- Delivery broken — derived, from the rotation.
  union all
  select 'wa_quality', count(*), min(t.created_at)
    from tenant_metrics m join tenants t on t.id = m.tenant_id
   where m.wa_quality = 'RED' or m.wa_health in ('FLAGGED','RESTRICTED')
  union all
  select 'marketing_paused', count(*), min(t.created_at)
    from tenant_metrics m join tenants t on t.id = m.tenant_id
   where m.marketing_paused
  union all
  select 'integrations_errored', count(*), min(t.created_at)
    from tenant_metrics m join tenants t on t.id = m.tenant_id
   where m.integrations_errored > 0
  union all
  select 'channel_silent', count(*), min(t.created_at)
    from tenant_metrics m join tenants t on t.id = m.tenant_id
   where m.channels > 0
     and (m.last_inbound_at is null or m.last_inbound_at < now() - interval '7 days')
  -- Onboarding stalled.
  union all
  select 'no_channel', count(*), min(t.created_at)
    from tenant_metrics m join tenants t on t.id = m.tenant_id
   where m.channels = 0
     and t.created_at < now() - interval '3 days'
     and t.status not in ('suspended','cancelled')
  union all
  select 'no_ai_key', count(*), min(t.created_at)
    from tenant_metrics m join tenants t on t.id = m.tenant_id
   where not m.ai_configured
     and t.created_at < now() - interval '3 days'
     and t.status not in ('suspended','cancelled')
  -- Growth.
  union all
  select 'near_limit', count(*), min(t.created_at)
    from tenant_metrics m join tenants t on t.id = m.tenant_id
   where m.usage_pct_max >= 80 and t.status not in ('suspended','cancelled');
$$;
