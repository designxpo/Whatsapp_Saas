-- 0033_form_responses.sql — track WhatsApp form lifecycle (sent → submitted /
-- abandoned), tenant-scoped + RLS. Powers the Responses view + chat indicators.
create table if not exists wa_form_responses (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null default '00000000-0000-0000-0000-000000000001' references tenants(id) on delete cascade,
  conversation_id uuid,
  phone           text,
  form_id         text,
  status          text not null default 'sent' check (status in ('sent','submitted','abandoned')),
  data            jsonb,
  sent_at         timestamptz not null default now(),
  submitted_at    timestamptz
);
create index if not exists wa_form_responses_tenant_idx on wa_form_responses(tenant_id);
create index if not exists wa_form_responses_conv_idx on wa_form_responses(conversation_id);
alter table wa_form_responses enable row level security;
drop policy if exists tenant_isolation on wa_form_responses;
create policy tenant_isolation on wa_form_responses
  using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id());
