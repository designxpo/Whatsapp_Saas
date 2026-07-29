-- Review reply system (Phase 1: AI engine + portal).
-- Stores business reviews (Google or manually added) and their AI-drafted /
-- posted replies. Phase 2 will populate these from the Google Business Profile
-- API (external_id + location) and flip reply_status to 'posted' on publish.
create table if not exists wa_reviews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default '00000000-0000-0000-0000-000000000001',
  source text not null default 'manual',          -- manual | google
  external_id text,                                -- Google review id (phase 2)
  location_name text,                              -- business / location label
  author text not null default '',
  rating int not null default 5,                   -- 1..5 stars
  text text not null default '',
  review_created_at timestamptz,
  reply_text text,
  reply_status text not null default 'none',       -- none | draft | posted
  auto boolean not null default false,             -- intended to auto-post (rating >= threshold)
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_wa_reviews_tenant on wa_reviews (tenant_id, created_at desc);
-- One row per Google review per tenant (phase-2 idempotent import).
create unique index if not exists idx_wa_reviews_ext on wa_reviews (tenant_id, source, external_id) where external_id is not null;
alter table wa_reviews enable row level security;
