-- Broadcast → flow link ("bot on broadcast"), tenant-scoped.
-- A campaign can name a flow that starts when a recipient replies. When a
-- broadcast message is delivered, each recipient is "armed": their next inbound
-- message starts that flow (regardless of trigger keyword), consumed once.

alter table wa_campaigns add column if not exists reply_flow_id uuid;

create table if not exists wa_flow_arms (
  tenant_id   uuid not null default '00000000-0000-0000-0000-000000000001',
  phone       text not null,            -- last-10 digits of the recipient
  flow_id     uuid not null,
  campaign_id uuid,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now(),
  primary key (tenant_id, phone)
);

create index if not exists wa_flow_arms_expires_idx on wa_flow_arms (expires_at);

alter table wa_flow_arms enable row level security;
drop policy if exists tenant_isolation on wa_flow_arms;
create policy tenant_isolation on wa_flow_arms
  using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id());
