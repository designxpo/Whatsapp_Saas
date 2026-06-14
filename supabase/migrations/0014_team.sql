-- ── Team members + activity log ──────────────────────────────────────────────
-- Portal users beyond the env admin. The env ADMIN_USER/ADMIN_PASSWORD keeps
-- working as the owner account; rows here are additional members. Passwords
-- are scrypt-hashed (salt:hash hex).

create table if not exists wa_users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  name          text not null default '',
  password_hash text not null,                -- scrypt: <salt-hex>:<hash-hex>
  role          text not null default 'member' check (role in ('admin','member')),
  active        boolean not null default true,
  last_login_at timestamptz,
  created_at    timestamptz not null default now()
);

-- Who did what, when — shown in Settings → Activity log.
create table if not exists wa_activity_log (
  id         uuid primary key default gen_random_uuid(),
  user_email text not null,
  user_name  text not null default '',
  action     text not null,                   -- e.g. broadcast.send, template.create
  detail     text not null default '',
  at         timestamptz not null default now()
);
create index if not exists wal_at_idx on wa_activity_log (at desc);
