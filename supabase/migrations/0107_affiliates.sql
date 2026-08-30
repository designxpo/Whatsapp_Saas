-- 0107_affiliates.sql — affiliate/referral program.
-- Anyone can enroll as an affiliate (no Talko tenant required) and get a
-- referral code. A tenant that signs up through that code is attributed to
-- the affiliate permanently. Every subscription payment that tenant makes
-- earns the affiliate a flat % commission, recorded as an append-only ledger
-- row so past commission never silently changes when a plan/rate changes later.

create table if not exists wa_affiliates (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text not null,
  phone text,
  password_hash text not null,
  code text not null unique,
  commission_pct numeric(5,2) not null default 10.00, -- overridden to 10.00 (was 20.00) by 0113_affiliate_commission_10pct.sql on already-applied databases
  status text not null default 'active' check (status in ('active','suspended')),
  payout_method text,
  created_at timestamptz not null default now()
);
create index if not exists wa_affiliates_code_idx on wa_affiliates (code);
create index if not exists wa_affiliates_status_created_idx on wa_affiliates (status, created_at desc);

alter table tenants add column if not exists referred_by_affiliate_id uuid references wa_affiliates(id) on delete set null;
create index if not exists tenants_referred_by_affiliate_idx on tenants (referred_by_affiliate_id) where referred_by_affiliate_id is not null;

create table if not exists wa_affiliate_commissions (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references wa_affiliates(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  stripe_subscription_id text,
  period_start timestamptz,
  period_end timestamptz,
  plan text not null,
  amount_cents int not null,
  commission_pct numeric(5,2) not null,
  commission_cents int not null,
  status text not null default 'pending' check (status in ('pending','paid','void')),
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique (affiliate_id, tenant_id, stripe_subscription_id, period_start)
);
create index if not exists wa_affiliate_commissions_affiliate_idx on wa_affiliate_commissions (affiliate_id, status, created_at desc);
create index if not exists wa_affiliate_commissions_tenant_idx on wa_affiliate_commissions (tenant_id, created_at desc);

-- Per-affiliate summary for the owner portal — avoids a JS loop over every
-- affiliate, mirrors the owner_platform_stats()-style aggregate from 0106.
create or replace function owner_affiliate_stats()
returns table (
  affiliate_id uuid, name text, email text, code text, commission_pct numeric,
  referred_count bigint, converted_count bigint,
  pending_cents bigint, paid_cents bigint, lifetime_cents bigint
) language sql stable as $$
  select
    a.id, a.name, a.email, a.code, a.commission_pct,
    count(distinct t.id) as referred_count,
    count(distinct t.id) filter (where t.payment_status = 'active') as converted_count,
    coalesce(sum(c.commission_cents) filter (where c.status = 'pending'), 0) as pending_cents,
    coalesce(sum(c.commission_cents) filter (where c.status = 'paid'), 0) as paid_cents,
    coalesce(sum(c.commission_cents), 0) as lifetime_cents
  from wa_affiliates a
  left join tenants t on t.referred_by_affiliate_id = a.id
  left join wa_affiliate_commissions c on c.affiliate_id = a.id
  group by a.id;
$$;
