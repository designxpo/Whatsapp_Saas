-- 0030_api_keys.sql — per-tenant public API keys. Replaces the single shared
-- BROADCAST_API_KEY: each tenant mints its own keys; the public API resolves
-- the calling tenant from the key (only the SHA-256 hash is stored).
create table if not exists wa_api_keys (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  name         text not null default 'API key',
  prefix       text not null,             -- display hint, e.g. "ak_live_3f9c…"
  key_hash     text not null,             -- sha256(full key)
  last_used_at timestamptz,
  revoked      boolean not null default false,
  created_at   timestamptz not null default now()
);
create index if not exists wa_api_keys_tenant_idx on wa_api_keys (tenant_id);
create unique index if not exists wa_api_keys_hash_idx on wa_api_keys (key_hash);
alter table wa_api_keys enable row level security;
drop policy if exists tenant_isolation on wa_api_keys;
create policy tenant_isolation on wa_api_keys
  using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id());
