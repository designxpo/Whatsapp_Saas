-- Phase 3 "integration health".
--
-- wa_unmatched_payments: a payment a gateway reported that matched no order
-- (or paid less than the order total). It used to be a console warning only,
-- so the money arrived and nobody in the business heard about it. One row per
-- payment (webhook retries upsert the same row); resolved by matching it to an
-- order or dismissing it, with who and when.
--
-- wa_work_alerts.kind gains 'integration': a connection that broke (a number
-- restricted, a token that can't refresh, Google access lost, deliveries
-- failing), emailed to the workspace's admins once per problem.

create table if not exists wa_unmatched_payments (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id) on delete cascade,
  provider            text not null default 'unknown',
  payment_key         text not null,               -- the gateway's payment id, else the link/reference id
  payment_ref         text,
  provider_payment_id text,
  amount_cents        int,
  order_id            uuid references wa_orders(id) on delete set null,
  reason              text not null check (reason in ('no_order','short_payment')),
  status              text not null default 'open' check (status in ('open','matched','dismissed')),
  resolved_by         text,
  resolved_at         timestamptz,
  created_at          timestamptz not null default now(),
  unique (tenant_id, provider, payment_key)
);
create index if not exists wa_unmatched_payments_open_idx on wa_unmatched_payments (tenant_id, status, created_at desc);
alter table wa_unmatched_payments enable row level security;
drop policy if exists tenant_isolation on wa_unmatched_payments;
create policy tenant_isolation on wa_unmatched_payments using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id());

alter table wa_work_alerts drop constraint if exists wa_work_alerts_kind_check;
alter table wa_work_alerts add constraint wa_work_alerts_kind_check check (kind in ('reply_overdue','task_due','integration'));
