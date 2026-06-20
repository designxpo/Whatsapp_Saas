-- 0058_pipeline.sql — lightweight sales pipeline (stage-on-contact + Kanban),
-- multi-tenant. Each contact sits in at most one stage; stages are configurable,
-- ordered, tenant-scoped, and can map to a LeadSquared ProspectStage + fire
-- automation (tag + sequence) on entry.

create table if not exists wa_pipeline_stages (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null default '00000000-0000-0000-0000-000000000001' references tenants(id) on delete cascade,
  name                  text not null,
  position              int not null default 0,
  color                 text,
  lsq_stage             text,
  on_enter_tag          text,
  on_enter_sequence_id  uuid,
  is_won                boolean not null default false,
  is_lost               boolean not null default false,
  created_at            timestamptz not null default now()
);
create index if not exists wa_pipeline_stages_tenant_idx on wa_pipeline_stages(tenant_id);
alter table wa_pipeline_stages enable row level security;
drop policy if exists tenant_isolation on wa_pipeline_stages;
create policy tenant_isolation on wa_pipeline_stages
  using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id());

alter table contacts add column if not exists pipeline_stage_id uuid references wa_pipeline_stages(id) on delete set null;
alter table contacts add column if not exists pipeline_updated_at timestamptz;
create index if not exists idx_contacts_pipeline_stage on contacts(pipeline_stage_id);
