-- 0060_legal_consent.sql — record legal acceptance at signup.
-- Captures WHEN a tenant's owner accepted the Terms / Privacy / Acceptable Use
-- policies and WHICH version they agreed to. Both columns are nullable so the
-- app keeps working before this is applied; signup is resilient and also writes
-- an immutable consent entry to wa_owner_audit ("signup.terms_accepted").

alter table tenants add column if not exists terms_accepted_at timestamptz;
alter table tenants add column if not exists terms_version text;

comment on column tenants.terms_accepted_at is 'When the owner accepted the legal policies at signup';
comment on column tenants.terms_version is 'Legal document version accepted (see LEGAL_VERSION)';
