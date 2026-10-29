-- 20261029130000_inbound_connections.sql — tools that send events IN.
--
-- wa_integrations is the outbound side (the portal → a webhook, Slack, a CRM) and
-- the action side (payment links, product import, Cal.com booking). This is the
-- inbound side: a business's Shopify, WooCommerce, Razorpay, Calendly, Cal.com,
-- Typeform or IndiaMART posts its events to /api/inbound/<token>, and each one
-- becomes the WhatsApp message the business chose for it (src/lib/inbound).
--
-- The token in that URL is the connection's identity, so only its sha256 is
-- stored for lookup; the token itself and the tool's secrets are one blob,
-- encrypted with src/lib/crypto.ts.
--
-- Idempotent: safe to run twice.

create table if not exists wa_inbound_connections (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id) on delete cascade,
  kind               text not null,
  status             text not null default 'connected' check (status in ('connected', 'paused')),
  config             jsonb not null default '{}'::jsonb,
  secret_enc         text not null,
  inbound_token_hash text not null unique,
  last_event_at      timestamptz,
  last_event_key     text,
  last_error         text,
  last_error_at      timestamptz,
  created_by         text not null default '',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (tenant_id, kind)
);

-- What each connection received. external_id is what happened (an order, a
-- payment, a booking); unique per connection, it is how a retry — or the same
-- webhook added twice — is recognised and not acted on again.
create table if not exists wa_inbound_events (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  connection_id uuid not null references wa_inbound_connections(id) on delete cascade,
  external_id   text,
  event_key     text not null,
  outcome       text not null,
  detail        text,
  phone_last4   text,
  created_at    timestamptz not null default now(),
  unique (connection_id, external_id)
);
create index if not exists wa_inbound_events_conn_idx on wa_inbound_events (connection_id, created_at desc);

-- Defense-in-depth, as everywhere else: the service role bypasses it, direct REST does not.
alter table wa_inbound_connections enable row level security;
drop policy if exists tenant_isolation on wa_inbound_connections;
create policy tenant_isolation on wa_inbound_connections
  using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id());

alter table wa_inbound_events enable row level security;
drop policy if exists tenant_isolation on wa_inbound_events;
create policy tenant_isolation on wa_inbound_events
  using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id());
