-- 0029_platform_flags.sql — platform-wide feature flags (owner control plane).
-- Global (NOT tenant-scoped): the product owner flips these for the whole
-- platform. Read server-side only via lib/flags.ts.
create table if not exists wa_platform_flags (
  key         text primary key,
  enabled     boolean not null default true,
  description text,
  updated_at  timestamptz not null default now()
);

insert into wa_platform_flags (key, enabled, description) values
  ('signups_enabled',    true, 'Allow new self-serve signups'),
  ('ai_replies_enabled', true, 'Global AI auto-reply kill switch'),
  ('instagram_enabled',  true, 'Allow Instagram channel features'),
  ('ads_enabled',        true, 'Allow Meta Ads features')
on conflict (key) do nothing;
