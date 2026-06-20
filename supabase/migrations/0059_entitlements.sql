-- 0059_entitlements.sql — tier-based feature entitlements (foundation).
-- Reconciles plans to the marketing lineup, adds a conversations/mo meter,
-- per-channel-type feature keys, a Creator/Creator Pro family, an enforcement
-- kill-switch flag, and grandfathers every EXISTING tenant so nothing changes
-- for current customers until the owner flips enforcement on.

-- 1) Grandfather flag — existing tenants keep every feature regardless of plan.
--    New signups (created after this migration) are plan-driven.
alter table tenants add column if not exists grandfathered boolean not null default false;
update tenants set grandfathered = true where created_at < now();

-- 2) Conversations-per-month meter: distinct threads with a message this month.
create or replace function tenant_active_conversations(p_tenant uuid, p_since timestamptz)
returns integer language sql stable as $$
  select count(distinct conversation_id)::int
  from wa_conv_messages
  where tenant_id = p_tenant and created_at >= p_since;
$$;

-- 3) Enforcement kill-switch — default OFF, so all feature/conversation gating
--    is dormant until the owner explicitly enables it.
insert into wa_platform_flags (key, enabled, description, updated_at)
values ('enforce_entitlements', false, 'Master switch for tier-based feature & conversation gating', now())
on conflict (key) do nothing;

-- 4) Reconcile plans to the marketing lineup + add the Creator family.
--    Prices in paise (₹). A limit of 0 = unlimited. Features use per-channel-type
--    keys. Existing plans are updated (price/features set; numeric limits only
--    loosened — channels raised, nothing tightened — so live limit enforcement
--    never blocks a current tenant). Creator / Creator Pro are inserted fresh.
insert into wa_plans (key, name, price_cents, currency, interval, limits, features, sort, active) values
  ('trial', 'Trial', 0, 'INR', 'month',
   '{"contacts":500,"conversations_per_month":100,"messages_per_month":1000,"channels":2,"team_seats":2}',
   '{"ch_whatsapp":true,"ch_instagram":true,"ch_messenger":true,"ch_webchat":true,"ai_autoreply":true,"broadcasts":true,"flows":true,"sequences":true,"commerce":true,"forms":true,"pipeline":true,"growth":true,"ads":true,"aihub":true,"crm":true}', 0, true),
  ('creator', 'Creator', 99900, 'INR', 'month',
   '{"contacts":5000,"conversations_per_month":3000,"messages_per_month":50000,"channels":1,"team_seats":2}',
   '{"ch_whatsapp":false,"ch_instagram":true,"ch_messenger":false,"ch_webchat":false,"ai_autoreply":true,"broadcasts":false,"flows":true,"sequences":false,"commerce":true,"forms":false,"pipeline":false,"growth":true,"ads":false,"aihub":false,"crm":false}', 1, true),
  ('creator-pro', 'Creator Pro', 249900, 'INR', 'month',
   '{"contacts":25000,"conversations_per_month":10000,"messages_per_month":150000,"channels":5,"team_seats":5}',
   '{"ch_whatsapp":false,"ch_instagram":true,"ch_messenger":true,"ch_webchat":true,"ai_autoreply":true,"broadcasts":false,"flows":true,"sequences":true,"commerce":true,"forms":true,"pipeline":false,"growth":true,"ads":true,"aihub":true,"crm":false}', 2, true),
  ('starter', 'Starter', 199900, 'INR', 'month',
   '{"contacts":5000,"conversations_per_month":1000,"messages_per_month":25000,"channels":2,"team_seats":3}',
   '{"ch_whatsapp":true,"ch_instagram":false,"ch_messenger":false,"ch_webchat":true,"ai_autoreply":true,"broadcasts":true,"flows":false,"sequences":false,"commerce":false,"forms":false,"pipeline":false,"growth":false,"ads":false,"aihub":false,"crm":false}', 3, true),
  ('growth', 'Growth', 499900, 'INR', 'month',
   '{"contacts":50000,"conversations_per_month":10000,"messages_per_month":250000,"channels":6,"team_seats":10}',
   '{"ch_whatsapp":true,"ch_instagram":true,"ch_messenger":true,"ch_webchat":true,"ai_autoreply":true,"broadcasts":true,"flows":true,"sequences":true,"commerce":true,"forms":true,"pipeline":true,"growth":true,"ads":true,"aihub":true,"crm":true}', 4, true),
  ('scale', 'Scale', 999900, 'INR', 'month',
   '{"contacts":0,"conversations_per_month":0,"messages_per_month":0,"channels":0,"team_seats":0}',
   '{"ch_whatsapp":true,"ch_instagram":true,"ch_messenger":true,"ch_webchat":true,"ai_autoreply":true,"broadcasts":true,"flows":true,"sequences":true,"commerce":true,"forms":true,"pipeline":true,"growth":true,"ads":true,"aihub":true,"crm":true}', 5, true)
on conflict (key) do update set
  name        = excluded.name,
  price_cents = excluded.price_cents,
  limits      = excluded.limits,
  features    = excluded.features,
  sort        = excluded.sort,
  active      = excluded.active;
