-- 20261029000000_mezmitra_link.sql — the link to Mezmitra, the restaurant system.
--
-- Mezmitra sends bill, booking and order events to POST /api/events and retries
-- them when it does not hear back. Without a receipt, a retry after a lost
-- response would send the guest the same WhatsApp message twice. Each request
-- carrying an Idempotency-Key is recorded here; a repeat gets the first answer
-- back and sends nothing.
--
-- Idempotent: safe to run twice. The connection itself lives in wa_integrations
-- (kind = 'mezmitra'), like every other connector.

create table if not exists wa_api_event_receipts (
  tenant_id    uuid not null references tenants(id) on delete cascade,
  idem_key     text not null check (length(idem_key) between 8 and 100),
  request_hash text not null,
  -- null while the first request is still being processed
  status_code  integer,
  response     jsonb,
  created_at   timestamptz not null default now(),
  primary key (tenant_id, idem_key)
);
create index if not exists wa_api_event_receipts_created_idx on wa_api_event_receipts (created_at);

-- Defense-in-depth, as everywhere else: the service role bypasses it, direct REST does not.
alter table wa_api_event_receipts enable row level security;
drop policy if exists tenant_isolation on wa_api_event_receipts;
create policy tenant_isolation on wa_api_event_receipts
  using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id());

-- The plan feature that sells the link: on for the trial (so restaurants can try it) and the
-- Growth and Scale plans, off elsewhere. Change it per plan or per tenant in the owner console.
update wa_plans set features = features || '{"restaurant_link": true}'::jsonb
  where key in ('trial', 'growth', 'scale') and not (features ? 'restaurant_link');
update wa_plans set features = features || '{"restaurant_link": false}'::jsonb
  where not (features ? 'restaurant_link');
