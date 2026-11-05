-- 20261105120000_reviews_cases_requests_reports.sql — Google Reviews, stages 2–4.
--
-- Stage 2 — complaint handling on a review, kept separate from its public
-- reply: who it is assigned to, an internal status (new → in progress →
-- waiting on customer → resolved), a follow-up date, an explicitly confirmed
-- link to a CRM contact (never inferred from a display name), and a history of
-- every change plus private notes (wa_review_activity).
--
-- Stage 3 — review requests become a queue: scheduled after a paid order, a
-- completed service event or by hand, sent once per order/event (unique source
-- reference), with quiet hours, a frequency limit and one optional reminder.
--
-- Stage 4 — one rating snapshot per location per day, taken from Google's own
-- figures, so trends are only ever drawn from days that were actually recorded.
--
-- Idempotent: safe to run twice. Apply BEFORE deploying the matching code.

-- ── Stage 2: complaint handling ──────────────────────────────────────────────
alter table wa_reviews add column if not exists assignee_id uuid references wa_users(id) on delete set null;
alter table wa_reviews add column if not exists case_status text
  check (case_status in ('new', 'in_progress', 'waiting_customer', 'resolved'));
alter table wa_reviews add column if not exists follow_up_at timestamptz;
alter table wa_reviews add column if not exists linked_contact_id uuid references contacts(id) on delete set null;

-- Complaints that already exist start as open cases.
update wa_reviews set case_status = 'new' where is_complaint and case_status is null;

create index if not exists wa_reviews_assignee_idx on wa_reviews (tenant_id, assignee_id) where assignee_id is not null;
create index if not exists wa_reviews_case_idx on wa_reviews (tenant_id, case_status, follow_up_at) where case_status is not null;

create table if not exists wa_review_activity (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  review_id   uuid not null references wa_reviews(id) on delete cascade,
  kind        text not null check (kind in ('note', 'assigned', 'status', 'follow_up', 'contact_linked', 'contact_unlinked', 'reply_posted', 'reply_removed')),
  actor_email text,
  actor_name  text,
  body        text not null default '',
  created_at  timestamptz not null default now()
);
create index if not exists wa_review_activity_review_idx on wa_review_activity (tenant_id, review_id, created_at);

alter table wa_review_activity enable row level security;
drop policy if exists tenant_isolation on wa_review_activity;
create policy tenant_isolation on wa_review_activity
  using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id());

-- ── Stage 3: review requests as a queue ──────────────────────────────────────
alter table wa_review_requests drop constraint if exists wa_review_requests_status_check;
alter table wa_review_requests add constraint wa_review_requests_status_check
  check (status in ('scheduled', 'sending', 'sent', 'skipped', 'failed', 'cancelled'));
alter table wa_review_requests alter column sent_at drop not null;
alter table wa_review_requests alter column sent_at drop default;
alter table wa_review_requests add column if not exists created_at timestamptz not null default now();
alter table wa_review_requests add column if not exists source text not null default 'order'
  check (source in ('order', 'event', 'manual'));
alter table wa_review_requests add column if not exists source_ref text;
alter table wa_review_requests add column if not exists event_key text;
alter table wa_review_requests add column if not exists channel_id uuid;   -- the Google location; no FK so history survives a disconnect
alter table wa_review_requests add column if not exists review_url text;
alter table wa_review_requests add column if not exists send_after timestamptz;
alter table wa_review_requests add column if not exists via text check (via in ('text', 'template'));
alter table wa_review_requests add column if not exists attempts int not null default 0;
alter table wa_review_requests add column if not exists reminder_sent_at timestamptz;
alter table wa_review_requests add column if not exists name text;

-- Requests recorded before the queue existed were sent (or skipped) when created.
update wa_review_requests set created_at = sent_at where sent_at is not null and created_at > sent_at;

-- Once per order (kept) and once per event or manual send reference.
create unique index if not exists wa_review_requests_source_uq on wa_review_requests (tenant_id, source, source_ref) where source_ref is not null;
create index if not exists wa_review_requests_due_idx on wa_review_requests (send_after) where status = 'scheduled';
create index if not exists wa_review_requests_phone_idx on wa_review_requests (tenant_id, phone, sent_at desc);

-- ── Stage 4: daily rating snapshots ──────────────────────────────────────────
create table if not exists wa_review_rating_snapshots (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id) on delete cascade,
  channel_id         uuid not null,          -- no FK: a disconnected location's history stays readable
  day                date not null,
  average_rating     numeric(3, 2),
  total_review_count int,
  created_at         timestamptz not null default now()
);
create unique index if not exists wa_review_rating_snapshots_day_uq on wa_review_rating_snapshots (tenant_id, channel_id, day);

alter table wa_review_rating_snapshots enable row level security;
drop policy if exists tenant_isolation on wa_review_rating_snapshots;
create policy tenant_isolation on wa_review_rating_snapshots
  using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id());
