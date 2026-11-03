-- 20261104120000_reviews_inbox_alerts.sql — Google Reviews, stage 1:
--
-- 1. wa_reviews learns which connected location a review belongs to, why a
--    reply is waiting for approval, what the review is about, whether it is a
--    complaint, who wrote the public reply, and why a post to Google failed.
--    A short-lived claim stops two background workers drafting the same reply.
-- 2. wa_review_alerts: one row per thing an owner should hear about (a new
--    review, a complaint, a failed post, lost Google access, a sync that keeps
--    failing, a review left unanswered). Unique per (tenant, dedupe_key), so a
--    retried job can never raise the same alert twice.
--
-- Idempotent: safe to run twice. Apply BEFORE deploying the matching code; the
-- code tolerates the old schema, but the new inbox needs these columns.

alter table wa_reviews add column if not exists channel_id uuid references wa_channels(id) on delete set null;
alter table wa_reviews add column if not exists review_updated_at timestamptz;
alter table wa_reviews add column if not exists approval_reasons text[] not null default '{}';
alter table wa_reviews add column if not exists topics text[] not null default '{}';
alter table wa_reviews add column if not exists is_complaint boolean not null default false;
alter table wa_reviews add column if not exists reply_source text
  check (reply_source in ('talko', 'google', 'manual'));
alter table wa_reviews add column if not exists post_error text;
alter table wa_reviews add column if not exists post_failed_at timestamptz;
alter table wa_reviews add column if not exists draft_error text;
alter table wa_reviews add column if not exists draft_claimed_at timestamptz;

-- Existing Google reviews: attach each to the connection whose account and
-- location its resource name ("accounts/A/locations/L/reviews/R") names.
update wa_reviews r set channel_id = c.id
  from wa_channels c
  where r.source = 'google' and r.channel_id is null
    and c.kind = 'google_reviews' and c.tenant_id = r.tenant_id
    and c.google_account_id is not null and c.google_location_id is not null
    and r.external_id like c.google_account_id || '/' || c.google_location_id || '/%';

-- Every review gets a "written at" so the inbox can sort on one column.
update wa_reviews set review_created_at = created_at where review_created_at is null;
update wa_reviews set is_complaint = true where rating between 1 and 2 and not is_complaint;
update wa_reviews set reply_source = case when source = 'manual' then 'manual' else 'talko' end
  where reply_status = 'posted' and reply_source is null;

create index if not exists wa_reviews_inbox_idx on wa_reviews (tenant_id, review_created_at desc);
create index if not exists wa_reviews_location_idx on wa_reviews (tenant_id, channel_id, review_created_at desc);
create index if not exists wa_reviews_status_idx on wa_reviews (tenant_id, reply_status);

-- wa_reviews had RLS on with no policy (service role only). Give it the same
-- tenant policy as every other tenant table.
drop policy if exists tenant_isolation on wa_reviews;
create policy tenant_isolation on wa_reviews
  using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id());

create table if not exists wa_review_alerts (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  kind        text not null check (kind in ('new_review', 'needs_approval', 'complaint', 'post_failed', 'reauth', 'sync_failing', 'overdue')),
  review_id   uuid references wa_reviews(id) on delete cascade,
  channel_id  uuid references wa_channels(id) on delete cascade,
  dedupe_key  text not null,
  title       text not null,
  body        text not null default '',
  created_at  timestamptz not null default now(),
  emailed_at  timestamptz,
  email_error text
);
create unique index if not exists wa_review_alerts_dedupe_uq on wa_review_alerts (tenant_id, dedupe_key);
create index if not exists wa_review_alerts_recent_idx on wa_review_alerts (tenant_id, created_at desc);
create index if not exists wa_review_alerts_unsent_idx on wa_review_alerts (created_at) where emailed_at is null;

alter table wa_review_alerts enable row level security;
drop policy if exists tenant_isolation on wa_review_alerts;
create policy tenant_isolation on wa_review_alerts
  using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id());
