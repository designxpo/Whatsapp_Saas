-- JWT revocation support. Each team member carries a token_version; it is
-- embedded in their session JWT at login and re-checked on every request, so
-- bumping it (on password change / suspected compromise) invalidates all of
-- that member's existing sessions before the 7-day token expiry.
alter table wa_users add column if not exists token_version integer not null default 0;
