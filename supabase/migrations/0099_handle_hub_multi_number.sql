-- ── Tracked Links — multiple numbers, each with its own sources (multi-tenant) ──
-- Handle Hub used to be ONE global-per-tenant WhatsApp number/handle/greeting
-- (wa_settings keys handle_hub_number/handle/greeting) shared by every tracked
-- source — a tenant couldn't run tracked links on two different WhatsApp
-- numbers at once (e.g. a PPC number and an organic number each needing their
-- own set of sources). Entry points make the number/handle/greeting a
-- per-row thing; sources now belong to ONE entry point and its link always
-- points at that entry point's number. ref_code stays unique WITHIN a tenant —
-- resolution (tenant_id, ref_code) is unaffected.
--
-- Additive + idempotent. Backfills each tenant's OLD single config (if one was
-- set) into one entry point and re-parents that tenant's existing sources onto
-- it, so nothing already configured is lost.

create table if not exists wa_handle_entry_points (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null default '00000000-0000-0000-0000-000000000001' references tenants(id) on delete cascade,
  label      text not null default '',              -- admin-facing name, e.g. "PPC WhatsApp (908)"
  number     text not null,                          -- digits only, with country code
  handle     text not null default '',
  greeting   text not null default 'Hi! I''d like to know more.',
  created_at timestamptz not null default now()
);

alter table wa_handle_sources add column if not exists entry_point_id uuid references wa_handle_entry_points(id) on delete cascade;

-- Backfill per tenant.
do $$
declare
  r record;
  new_ep_id uuid;
begin
  for r in
    select tenant_id, (value #>> '{}') as number
    from wa_settings
    where key = 'handle_hub_number' and coalesce(value #>> '{}', '') <> ''
  loop
    insert into wa_handle_entry_points (tenant_id, label, number, handle, greeting)
    values (
      r.tenant_id, 'Default', r.number,
      coalesce((select value #>> '{}' from wa_settings where tenant_id = r.tenant_id and key = 'handle_hub_handle'), ''),
      coalesce(nullif((select value #>> '{}' from wa_settings where tenant_id = r.tenant_id and key = 'handle_hub_greeting'), ''), 'Hi! I''d like to know more.')
    )
    returning id into new_ep_id;
    update wa_handle_sources set entry_point_id = new_ep_id where tenant_id = r.tenant_id and entry_point_id is null;
  end loop;
end $$;

create index if not exists wa_handle_sources_entry_point on wa_handle_sources (entry_point_id);
create index if not exists wa_handle_entry_points_tenant on wa_handle_entry_points (tenant_id);

comment on table wa_handle_entry_points is
  'One row per WhatsApp number a tenant''s Tracked Links can generate links for. Each source (wa_handle_sources) belongs to exactly one entry point.';

alter table wa_handle_entry_points enable row level security;
