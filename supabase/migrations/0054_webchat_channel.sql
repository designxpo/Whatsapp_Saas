-- Website web-chat widget channel (kind = 'webchat').
--   • site_key        — public key embedded in the loader script; routes inbound.
--   • allowed_origins — CORS allowlist of site origins permitted to use the key
--                       (empty array = allow any origin, for quick start / dev).
alter table wa_channels add column if not exists site_key text;
alter table wa_channels add column if not exists allowed_origins text[] not null default '{}';

-- Fast public lookup by site key (and it should be unique per workspace).
create unique index if not exists wa_channels_site_key_uq on wa_channels (site_key) where site_key is not null;
