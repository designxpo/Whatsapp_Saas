-- 0043_contact_opt_in.sql — proof-of-opt-in for contacts. Sending MARKETING
-- templates to non-opted-in numbers is Meta's #1 cause of number bans. We add a
-- consent record and let broadcasts filter to opted-in recipients.
--
-- Migration safety: EXISTING contacts are grandfathered to opted_in=true (so a
-- live tenant's broadcasts don't suddenly stop). Going forward, inbound messages
-- and growth opt-ins set true with proof, while un-attested CSV/API imports are
-- stored opted_in=false and excluded from marketing audiences by default.

alter table contacts add column if not exists opted_in    boolean not null default true;
alter table contacts add column if not exists opt_in_source text;     -- inbound | growth | import_attested | api_attested | legacy | manual
alter table contacts add column if not exists opt_in_at   timestamptz;
alter table contacts add column if not exists opt_in_proof text;      -- free-text evidence (e.g. "WA inbound 2026-06-16", "website form")

-- Grandfather existing rows with an explicit legacy marker.
update contacts set opt_in_source = 'legacy', opt_in_at = coalesce(opt_in_at, created_at)
  where opt_in_source is null;

-- Partial index for the opted-in marketing audience query.
create index if not exists contacts_tenant_optin_idx on contacts (tenant_id) where opted_in;
