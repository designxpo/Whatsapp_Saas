-- White-label, Phase 3: the partner dashboard.
--
-- Partner staff are their own accounts, separate from workspace users: they
-- manage the partner's customers at `<slug>.<base>/partner`, never inside a
-- workspace. An account is created by invitation with no password; the
-- invitee sets one through a single-use link (only its SHA-256 hash is
-- stored, and it expires).
--
-- A reseller's own price for each plan lives on the partner, in rupee cents,
-- never below Talko's list price (checked in src/lib/partner-portal.ts).
--
-- Apply after 20261030140000_partner_brand.sql.

create table if not exists wa_partner_users (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references wa_partners(id) on delete cascade,
  email text not null unique,
  name text not null default '',
  role text not null default 'staff' check (role in ('owner', 'staff')),
  password_hash text,
  setup_token_hash text,
  setup_expires_at timestamptz,
  -- Bumped on sign-out-everywhere, password change or removal; old sessions die.
  token_version int not null default 0,
  active boolean not null default true,
  last_login_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists wa_partner_users_partner_idx on wa_partner_users (partner_id);
create index if not exists wa_partner_users_setup_idx on wa_partner_users (setup_token_hash) where setup_token_hash is not null;

alter table wa_partners add column if not exists resale_prices jsonb not null default '{}'::jsonb;

alter table wa_partner_users enable row level security;
