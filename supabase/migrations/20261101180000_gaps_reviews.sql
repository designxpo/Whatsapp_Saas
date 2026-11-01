-- 20261101180000_gaps_reviews.sql — questions the AI couldn't answer, and
-- Google review requests sent on WhatsApp.
--
-- wa_ai_gaps: one row each time the AI couldn't answer a real question from the
-- knowledge base (it handed off, or could only ask for more detail). Grouped by
-- a normalised form of the question; answering a group adds a knowledge-base
-- entry and resolves every phrasing of it.
--
-- wa_review_requests: one row per review request — who, which order, the
-- tracked link's token, and whether it was opened. Hot leads need no table:
-- they are worked out from the conversations themselves.
--
-- Idempotent: safe to run twice.

create table if not exists wa_ai_gaps (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  platform      text not null default 'whatsapp',
  question      text not null,
  question_key  text not null,
  reason        text not null,
  phone         text,
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz,
  resolution    text check (resolution in ('answered', 'dismissed')),
  resolved_by   text,
  kb_doc_id     uuid
);
create index if not exists wa_ai_gaps_open_idx on wa_ai_gaps (tenant_id, created_at desc) where resolved_at is null;
create index if not exists wa_ai_gaps_key_idx on wa_ai_gaps (tenant_id, question_key);

alter table wa_ai_gaps enable row level security;
drop policy if exists tenant_isolation on wa_ai_gaps;
create policy tenant_isolation on wa_ai_gaps
  using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id());

create table if not exists wa_review_requests (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  phone         text not null,
  order_id      uuid,
  token         text not null unique,
  status        text not null default 'sent' check (status in ('sent', 'skipped', 'failed')),
  detail        text,
  sent_at       timestamptz not null default now(),
  clicked_at    timestamptz,
  clicks        int not null default 0
);
-- One request per order, ever.
create unique index if not exists wa_review_requests_order_uq on wa_review_requests (tenant_id, order_id) where order_id is not null;
create index if not exists wa_review_requests_list_idx on wa_review_requests (tenant_id, sent_at desc);

alter table wa_review_requests enable row level security;
drop policy if exists tenant_isolation on wa_review_requests;
create policy tenant_isolation on wa_review_requests
  using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id());
