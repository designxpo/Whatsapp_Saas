-- Phase 5 "business results".
--
-- wa_orders.source: where the customer came from, copied from their contact
-- record when the order is placed (Meta ad, UTM tags, tracked link, ad click
-- ids). Copied, not looked up later, because a contact's attributes change.
--
-- wa_lead_reads: each time the AI's read of a lead changes (status, ready to
-- pay), so Results can say how often "ready to pay" turned into a payment.
-- The chat only keeps the latest read.

alter table wa_orders add column if not exists source jsonb;

create table if not exists wa_lead_reads (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  conversation_id uuid references wa_conversations(id) on delete cascade,
  phone           text not null,
  status          text,
  score           int,
  ready_to_pay    boolean not null default false,
  reason          text,
  created_at      timestamptz not null default now()
);
create index if not exists wa_lead_reads_tenant_idx on wa_lead_reads (tenant_id, created_at desc);
alter table wa_lead_reads enable row level security;
drop policy if exists tenant_isolation on wa_lead_reads;
create policy tenant_isolation on wa_lead_reads using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id());
