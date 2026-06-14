-- 0024_saas_owner.sql — product-owner portal: subscription, billing, feature
-- flags, and the signup/onboarding info captured per tenant.

-- ── Tenant subscription + signup fields ───────────────────────────────────────
alter table tenants add column if not exists company        text;
alter table tenants add column if not exists owner_name     text;
alter table tenants add column if not exists owner_email     text;
alter table tenants add column if not exists owner_phone     text;
alter table tenants add column if not exists industry        text;
alter table tenants add column if not exists team_size       text;
alter table tenants add column if not exists use_case        text;      -- why they signed up
alter table tenants add column if not exists expected_volume text;      -- monthly message estimate
alter table tenants add column if not exists source          text;      -- where they came from

-- Billing / subscription
alter table tenants add column if not exists payment_status   text not null default 'trialing';  -- trialing | active | past_due | cancelled | none
alter table tenants add column if not exists trial_ends_at    timestamptz;
alter table tenants add column if not exists current_period_end timestamptz;
alter table tenants add column if not exists amount_cents     int not null default 0;            -- recurring price
alter table tenants add column if not exists currency         text not null default 'INR';
alter table tenants add column if not exists notes            text;                              -- owner-only notes

-- Per-tenant feature entitlements (owner toggles these). Null → plan defaults.
alter table tenants add column if not exists features jsonb not null default
  '{"whatsapp":true,"instagram":true,"sequences":true,"commerce":true,"growth":true,"ai_autoreply":true,"ads":true}'::jsonb;

-- Onboarding/walkthrough completion (per tenant, MVP).
alter table tenants add column if not exists onboarded boolean not null default false;

-- ── Owner action audit ────────────────────────────────────────────────────────
create table if not exists wa_owner_audit (
  id          uuid primary key default gen_random_uuid(),
  actor_email text not null,
  action      text not null,            -- subscription.update | feature.toggle | impersonate | tenant.suspend ...
  tenant_id   uuid references tenants(id) on delete set null,
  detail      text,
  created_at  timestamptz not null default now()
);
create index if not exists wa_owner_audit_created_idx on wa_owner_audit (created_at desc);
