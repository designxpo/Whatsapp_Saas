-- ── Ad drafts + portal-created campaign tracking ─────────────────────────────
-- Drafts let the ad builder auto-save in-progress ads so an accidental refresh
-- never loses work (and never accidentally launches a live campaign). The
-- portal-campaigns table records which campaigns were created from this portal,
-- so the dashboard can separate them from ads made directly in Ads Manager.

create table if not exists wa_ad_drafts (
  id         uuid primary key default gen_random_uuid(),
  name       text not null default 'Untitled ad',
  data       jsonb not null default '{}',     -- full builder form snapshot
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists wa_portal_campaigns (
  campaign_id text primary key,               -- Meta campaign id created here
  name        text,
  created_at  timestamptz not null default now()
);
