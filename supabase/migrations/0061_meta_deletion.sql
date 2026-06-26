-- 0061_meta_deletion.sql — track Meta data-deletion requests.
-- Meta POSTs a signed callback when a user removes the app or requests deletion;
-- /api/webhooks/meta-deletion records the request here and the public status page
-- (/legal/data-deletion?code=…) confirms it. The app is resilient if this isn't
-- applied yet (it falls back to wa_owner_audit), but this table powers status.

create table if not exists meta_deletion_requests (
  id                uuid primary key default gen_random_uuid(),
  confirmation_code text not null unique,
  meta_user_id      text not null,
  status            text not null default 'received',   -- received | processing | completed
  created_at        timestamptz not null default now(),
  completed_at      timestamptz
);

create index if not exists idx_meta_deletion_code on meta_deletion_requests(confirmation_code);
