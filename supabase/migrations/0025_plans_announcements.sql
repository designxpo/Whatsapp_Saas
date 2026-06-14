-- 0025_plans_announcements.sql — owner control-plane phase 1:
-- editable plans (price + limits + feature defaults) and platform announcements
-- (with a pinnable global banner shown to all tenants).

-- ── Plans ─────────────────────────────────────────────────────────────────────
create table if not exists wa_plans (
  id          uuid primary key default gen_random_uuid(),
  key         text unique not null,                 -- trial | starter | growth | scale | custom-…
  name        text not null,
  price_cents int not null default 0,
  currency    text not null default 'INR',
  interval    text not null default 'month',        -- month | year
  -- 0 = unlimited
  limits      jsonb not null default '{"contacts":0,"messages_per_month":0,"channels":1,"team_seats":2}'::jsonb,
  features    jsonb not null default '{"whatsapp":true,"instagram":true,"sequences":true,"commerce":true,"growth":true,"ai_autoreply":true,"ads":true}'::jsonb,
  sort        int not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

insert into wa_plans (key, name, price_cents, limits, features, sort) values
  ('trial',   'Trial',    0,     '{"contacts":500,"messages_per_month":1000,"channels":1,"team_seats":2}',      '{"whatsapp":true,"instagram":true,"sequences":true,"commerce":false,"growth":true,"ai_autoreply":true,"ads":false}', 0),
  ('starter', 'Starter',  149900,'{"contacts":5000,"messages_per_month":25000,"channels":1,"team_seats":3}',    '{"whatsapp":true,"instagram":true,"sequences":true,"commerce":true,"growth":true,"ai_autoreply":true,"ads":true}', 1),
  ('growth',  'Growth',   399900,'{"contacts":50000,"messages_per_month":250000,"channels":3,"team_seats":10}', '{"whatsapp":true,"instagram":true,"sequences":true,"commerce":true,"growth":true,"ai_autoreply":true,"ads":true}', 2),
  ('scale',   'Scale',    999900,'{"contacts":0,"messages_per_month":0,"channels":0,"team_seats":0}',           '{"whatsapp":true,"instagram":true,"sequences":true,"commerce":true,"growth":true,"ai_autoreply":true,"ads":true}', 3)
on conflict (key) do nothing;

-- ── Announcements / global banner ─────────────────────────────────────────────
create table if not exists wa_announcements (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  body       text not null default '',
  level      text not null default 'info' check (level in ('info','success','warning')),
  pinned     boolean not null default false,        -- show as a site-wide banner to all tenants
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
