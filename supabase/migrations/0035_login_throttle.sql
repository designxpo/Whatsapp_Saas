-- Brute-force protection for the admin login. Each failed attempt records a
-- row keyed by "<ip>:<username>"; the login route locks the key after too many
-- failures inside the window. Successful logins clear the key. Rows are
-- self-expiring via the cleanup in the app (and can be pruned by a cron).
create table if not exists wa_login_attempts (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  created_at timestamptz not null default now()
);

create index if not exists wa_login_attempts_key_idx
  on wa_login_attempts (key, created_at desc);
