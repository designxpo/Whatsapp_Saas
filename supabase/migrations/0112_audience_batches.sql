-- Audience batches: named, selectable broadcast audiences.
--
-- The send composer could only target all / tag / attribute / a pasted list.
-- Tags in practice are auto-stamped provenance labels ('whatsapp', 'web-chat'),
-- so "send to these specific people" had no answer. A batch is a first-class,
-- named audience a tenant can pick in Broadcast.
--
-- Unlike the internal build, NO consent columns are added here: this schema
-- already carries contacts.opted_in / opt_in_source / opt_in_at / opt_in_proof,
-- markOptedIn(), and every broadcast path already resolves its audience with
-- onlyOptedIn = true. Batches read that existing state rather than introducing
-- a second, competing record of consent.
--
-- Additive + idempotent.

-- Two kinds, deliberately:
--   static  — an explicit membership list (wa_batch_members). Reconstructable
--             after the fact, so "who did this broadcast go to?" is answerable.
--             That auditability is why it is the default.
--   dynamic — stored criteria re-evaluated at send time. Always current, but
--             past membership is NOT recoverable, so such a send relies on
--             wa_send_log as its audit trail.
create table if not exists wa_batches (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null default '00000000-0000-0000-0000-000000000001' references tenants(id) on delete cascade,
  name        text not null,
  description text,
  kind        text not null default 'static' check (kind in ('static', 'dynamic')),
  -- dynamic only: AND-combined optional criteria
  --   { "tag": "...", "attributeKey": "...", "attributeValue": "...",
  --     "source": "...", "stageId": "uuid" }
  filter      jsonb not null default '{}'::jsonb,
  created_by  text,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Names are how a person picks a batch in the composer, so two LIVE batches in
-- the same workspace must not share one. Scoped per tenant: two workspaces may
-- both have an "Aug weekend batch". Archived names free up for reuse.
create unique index if not exists wa_batches_tenant_name_live_idx
  on wa_batches (tenant_id, lower(name)) where archived_at is null;

create table if not exists wa_batch_members (
  batch_id   uuid not null references wa_batches(id) on delete cascade,
  contact_id uuid not null references contacts(id)   on delete cascade,
  tenant_id  uuid not null default '00000000-0000-0000-0000-000000000001' references tenants(id) on delete cascade,
  added_by   text,
  added_at   timestamptz not null default now(),
  primary key (batch_id, contact_id)
);

-- Resolving a batch reads every member of one batch, newest first in the UI.
create index if not exists wa_batch_members_batch_idx on wa_batch_members (batch_id, added_at desc);
-- The Live Chat panel asks "which batches is this lead in?".
create index if not exists wa_batch_members_contact_idx on wa_batch_members (contact_id);

comment on table wa_batches is
  'A named broadcast audience. kind=static uses explicit wa_batch_members; kind=dynamic re-evaluates `filter` at send time.';
comment on column wa_batches.filter is
  'Dynamic batches only: AND-combined optional criteria (tag, attributeKey+attributeValue, source, stageId). Ignored for static batches.';
comment on column wa_batches.archived_at is
  'Set instead of deleting, so a past broadcast keeps a resolvable audience name. Archived batches are hidden from the picker.';
comment on table wa_batch_members is
  'Static batch membership. tenant_id is denormalised from the batch so every read can be tenant-scoped without a join.';

-- RLS (see 0029): the app uses the service role, which bypasses RLS, so this
-- changes no app behaviour. It makes the new tables deny-by-default for the
-- public anon key — the backstop behind app-layer tenant scoping.
alter table wa_batches       enable row level security;
alter table wa_batch_members enable row level security;
