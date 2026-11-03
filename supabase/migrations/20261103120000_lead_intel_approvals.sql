-- 20261103120000_lead_intel_approvals.sql — the AI sales closer's two missing
-- pieces (lead-intel.ts, approvals.ts):
--
-- 1. A lead read on every conversation, refreshed after new messages: where the
--    lead stands (Cold / Warm / Hot / Won / OptOut), how likely they are to buy
--    (1–100), why, whether they are ready to pay now, and whether a person is
--    needed. Synced to the CRM.
-- 2. Discounts and refunds the AI may only ASK for: each request waits here
--    for a person to approve or reject it; nothing is promised to the customer
--    until they do.
--
-- Idempotent: safe to run twice.

alter table wa_conversations add column if not exists lead_status text
  check (lead_status in ('Cold', 'Warm', 'Hot', 'Won', 'OptOut'));
alter table wa_conversations add column if not exists intent_score int
  check (intent_score between 1 and 100);
alter table wa_conversations add column if not exists lead_reason text;
alter table wa_conversations add column if not exists ready_to_pay boolean not null default false;
alter table wa_conversations add column if not exists lead_action text
  check (lead_action in ('DISCOUNT_REQUEST', 'REFUND_REQUEST', 'HUMAN_TAKEOVER'));
alter table wa_conversations add column if not exists lead_scored_at timestamptz;

-- The scoring sweep reads the most recently active chats first.
create index if not exists wa_conversations_lead_due_idx on wa_conversations (last_inbound_at desc);
create index if not exists wa_conversations_ready_idx on wa_conversations (tenant_id, lead_scored_at desc)
  where ready_to_pay;

create table if not exists wa_approval_requests (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  conversation_id uuid references wa_conversations(id) on delete cascade,
  phone           text not null,
  platform        text not null default 'whatsapp',
  kind            text not null check (kind in ('discount', 'refund')),
  -- Discount asked for, in whole percent. Null for refunds.
  percent         int check (percent between 1 and 100),
  -- Over the workspace's limit when asked: shown to the approver, never to the customer.
  over_limit      boolean not null default false,
  reason          text,
  order_id        uuid,
  status          text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by      text,
  decided_at      timestamptz,
  -- What was sent to the customer on the decision, and the order it created.
  decision_message text,
  result_order_id uuid,
  created_at      timestamptz not null default now()
);
create index if not exists wa_approval_requests_pending_idx on wa_approval_requests (tenant_id, created_at desc) where status = 'pending';
create index if not exists wa_approval_requests_conv_idx on wa_approval_requests (conversation_id, created_at desc);
-- One open request of each kind per chat: a second ask updates the first.
create unique index if not exists wa_approval_requests_one_open on wa_approval_requests (conversation_id, kind) where status = 'pending';

alter table wa_approval_requests enable row level security;
drop policy if exists tenant_isolation on wa_approval_requests;
create policy tenant_isolation on wa_approval_requests
  using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id());
