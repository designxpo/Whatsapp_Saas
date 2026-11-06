-- Phase 1 "Today": one place for the work that needs a person, each item with
-- a person, a next action and a deadline.
--
--   contacts.owner_id      who looks after this customer
--   wa_tasks               follow-ups with an assignee and a due time
--   wa_work_alerts         overdue-reply and task-due alerts (bell + email),
--                          one row per event, deduped like wa_review_alerts
--   wa_orders.payment_url  the pay link minted at checkout, so a reminder can
--                          resend it; unpaid_reminded_at makes that reminder once
--
-- Every table is tenant-scoped with the same tenant_isolation policy as the rest.

alter table contacts add column if not exists owner_id uuid references wa_users(id) on delete set null;
create index if not exists contacts_owner_idx on contacts (tenant_id, owner_id) where owner_id is not null;

create table if not exists wa_tasks (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  title           text not null check (char_length(title) between 1 and 300),
  notes           text not null default '',
  due_at          timestamptz,
  status          text not null default 'open' check (status in ('open','done','cancelled')),
  assignee_id     uuid references wa_users(id) on delete set null,
  -- A task about a customer goes when the customer is erased.
  contact_id      uuid references contacts(id) on delete cascade,
  conversation_id uuid references wa_conversations(id) on delete set null,
  order_id        uuid references wa_orders(id) on delete set null,
  created_by      text not null default '',
  created_at      timestamptz not null default now(),
  done_at         timestamptz,
  done_by         text
);
create index if not exists wa_tasks_open_idx on wa_tasks (tenant_id, status, due_at);
create index if not exists wa_tasks_contact_idx on wa_tasks (tenant_id, contact_id) where contact_id is not null;
create index if not exists wa_tasks_assignee_idx on wa_tasks (tenant_id, assignee_id, status);
alter table wa_tasks enable row level security;
drop policy if exists tenant_isolation on wa_tasks;
create policy tenant_isolation on wa_tasks using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id());

create table if not exists wa_work_alerts (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  kind            text not null check (kind in ('reply_overdue','task_due')),
  dedupe_key      text not null,
  conversation_id uuid references wa_conversations(id) on delete cascade,
  task_id         uuid references wa_tasks(id) on delete cascade,
  channel_id      uuid,
  -- Who should hear about it: a teammate's email, or null for the workspace's admins.
  recipient       text,
  title           text not null,
  body            text not null default '',
  created_at      timestamptz not null default now(),
  emailed_at      timestamptz,
  email_error     text,
  unique (tenant_id, dedupe_key)
);
create index if not exists wa_work_alerts_email_idx on wa_work_alerts (created_at) where emailed_at is null;
create index if not exists wa_work_alerts_tenant_idx on wa_work_alerts (tenant_id, created_at desc);
alter table wa_work_alerts enable row level security;
drop policy if exists tenant_isolation on wa_work_alerts;
create policy tenant_isolation on wa_work_alerts using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id());

alter table wa_orders add column if not exists payment_url text;
alter table wa_orders add column if not exists unpaid_reminded_at timestamptz;
create index if not exists wa_orders_unpaid_idx on wa_orders (status, created_at) where status = 'pending' and unpaid_reminded_at is null;
