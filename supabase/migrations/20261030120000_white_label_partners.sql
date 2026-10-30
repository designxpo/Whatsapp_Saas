-- White-label, Phase 1: partners and the workspaces they own.
--
-- A partner is a business that runs Talko under its own brand. Two kinds:
--   private   — one company using Talko for its own business (Private Label);
--   reseller  — an agency or consultant selling Talko to its own clients.
-- Both are the same record so branding, billing and the owner console treat
-- them alike; `kind` decides what the partner dashboard shows.
--
-- A workspace (tenant) belongs to at most one partner, or to none — every
-- workspace that exists today stays partner-less and keeps the Talko brand.
-- The platform's own default workspace can never belong to a partner.
--
-- Prices are stored per partner, set from the business-plan defaults when the
-- partner is created, so a later price change never rewrites a signed deal.

create table if not exists wa_partners (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- The partner's address on Talko's domain (`<slug>.thetalko.in`, Phase 2).
  slug text not null unique check (slug ~ '^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$'),
  kind text not null check (kind in ('private', 'reseller')),
  tier text not null default 'standard' check (tier in ('standard', 'pro')),
  status text not null default 'onboarding' check (status in ('onboarding', 'active', 'paused', 'closed')),
  contact_name text,
  contact_email text,
  contact_phone text,
  -- Plan keys this partner may use or sell (wa_plans.key).
  allowed_plans text[] not null default '{}',
  setup_fee_cents int not null default 0 check (setup_fee_cents >= 0),
  -- Private Label: the monthly brand fee. Reseller: the monthly platform fee.
  monthly_fee_cents int not null default 0 check (monthly_fee_cents >= 0),
  deposit_cents int not null default 0 check (deposit_cents >= 0),
  -- Reseller only: share of Talko's list price paid per active workspace.
  wholesale_pct numeric(5, 2) check (wholesale_pct is null or (wholesale_pct > 0 and wholesale_pct <= 100)),
  grace_days int not null default 7 check (grace_days between 0 and 60),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists wa_partners_status_idx on wa_partners (status, created_at desc);

alter table tenants add column if not exists partner_id uuid references wa_partners(id) on delete restrict;
create index if not exists tenants_partner_idx on tenants (partner_id) where partner_id is not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tenants_default_has_no_partner') then
    alter table tenants add constraint tenants_default_has_no_partner
      check (partner_id is null or id <> '00000000-0000-0000-0000-000000000001'::uuid);
  end if;
end $$;

-- Every change to a partner or its workspaces, newest first. Append-only.
create table if not exists wa_partner_audit (
  id bigint generated always as identity primary key,
  partner_id uuid not null references wa_partners(id) on delete cascade,
  actor text not null,
  action text not null,
  tenant_id uuid references tenants(id) on delete set null,
  detail text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists wa_partner_audit_partner_idx on wa_partner_audit (partner_id, created_at desc);

-- Deny-by-default for the public API roles, like every table since 0120.
-- Server paths use the service role, which bypasses RLS.
alter table wa_partners enable row level security;
alter table wa_partner_audit enable row level security;
