-- Pre-launch waitlist / interest submissions from the marketing site.
-- A prospect leaves their details + the plan they want; the owner reviews these
-- in the Owner Portal and reaches out on launch day. Not tenant-scoped (these
-- are prospects, not tenants yet); inserted via the service role from the public
-- POST /api/waitlist route, so RLS stays on with no public policy.
create table if not exists wa_waitlist (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  email text not null default '',
  phone text,
  company text,
  plan text,                                  -- selected plan name (free text — marketing tier label)
  channels text[] not null default '{}',      -- channels they're interested in
  message text,
  source text not null default 'marketing',
  status text not null default 'new',          -- new | contacted | converted | archived
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_wa_waitlist_created on wa_waitlist (created_at desc);
alter table wa_waitlist enable row level security;
