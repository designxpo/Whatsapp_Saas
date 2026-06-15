-- 0027_tenancy_commerce_growth.sql — extend multi-tenancy to the 0022 tables.
--
-- The sequences / commerce / growth tables were created in 0022, AFTER 0019's
-- tenant-retrofit loop ran, so they never got a tenant_id. This applies the
-- exact same pattern (column + backfill + FK + index + RLS) to them, and fixes
-- wa_growth_tools.slug to be unique PER TENANT instead of globally.
do $$
declare
  t text;
  tbls text[] := array[
    'wa_sequences','wa_sequence_steps','wa_sequence_enrollments',
    'wa_products','wa_carts','wa_orders','wa_growth_tools'
  ];
begin
  foreach t in array tbls loop
    if to_regclass(t) is null then
      raise notice 'skip %, not present', t;
      continue;
    end if;
    execute format('alter table %I add column if not exists tenant_id uuid', t);
    execute format('update %I set tenant_id = %L where tenant_id is null',
                   t, '00000000-0000-0000-0000-000000000001');
    execute format('alter table %I alter column tenant_id set not null', t);
    execute format('alter table %I alter column tenant_id set default %L',
                   t, '00000000-0000-0000-0000-000000000001');
    execute format('alter table %I drop constraint if exists %I', t, t || '_tenant_fk');
    execute format('alter table %I add constraint %I foreign key (tenant_id) references tenants(id) on delete cascade',
                   t, t || '_tenant_fk');
    execute format('create index if not exists %I on %I (tenant_id)', t || '_tenant_idx', t);
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists tenant_isolation on %I', t);
    execute format($p$create policy tenant_isolation on %I
        using (tenant_id = current_tenant_id())
        with check (tenant_id = current_tenant_id())$p$, t);
  end loop;
end $$;

-- Growth-tool public slug must be unique per tenant, not globally — two tenants
-- can each have a /g/welcome. Drop the global unique, add a composite one.
alter table wa_growth_tools drop constraint if exists wa_growth_tools_slug_key;
create unique index if not exists wa_growth_tools_tenant_slug_key
  on wa_growth_tools (tenant_id, slug);
