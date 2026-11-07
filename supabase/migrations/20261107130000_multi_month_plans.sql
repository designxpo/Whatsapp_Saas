-- 20261107130000_multi_month_plans.sql — multi-month billing plans, invite-only
-- plans and per-tenant plan grants.
--
-- billing_months: how many months one charge covers (1, 3, 6 or 12). Razorpay
--   Plans are minted with period 'monthly' and interval = billing_months, so a
--   6-month plan is ONE charge of price_cents (grossed up) every 6 months.
--   price_cents is the base price for the WHOLE billing period.
-- invite_only: hidden from the billing page and refused at checkout unless the
--   tenant has a wa_plan_grants row, or (for '*-partner' plans) qualifies as a
--   partner. Enforced in application code (src/lib/plan-eligibility.ts).
--
-- Seeds are INSERT ... SELECT from the existing monthly plan, ON CONFLICT DO
-- NOTHING: never overwrites an edited row, and a no-op if the base plan is
-- missing. Limits and features are copied from the monthly plan. razorpay_plan_id
-- and stripe_price_id are deliberately NOT copied (the Razorpay Plan is minted
-- on first checkout).
--
--   *-6m          = 6 x monthly x 0.90   (10% founding discount)
--   *-6m-partner  = 6 x monthly x 0.80   (20% off the monthly rate: 10% founding + 10% partner)
-- Rounded to whole paise. Mirrored by sixMonthPlanPriceCents() in
-- src/lib/plans.ts, which a unit test checks against these formulas.
-- sort: base plan's sort + 100 (regular) / + 150 (partner), so they follow the
-- standard plans in listings.
--
-- ── Adding a 12-month variant later (one row, no code change) ──────────────
--   insert into wa_plans (key, name, price_cents, currency, interval, limits, features, sort, active, billing_months, invite_only)
--   select 'creator-12m', 'Creator (12 months)', round(price_cents * 12 * 0.85)::int, currency, interval,
--          limits, features, sort + 200, true, 12, false
--     from wa_plans where key = 'creator'
--   on conflict (key) do nothing;
-- (choose your own discount factor; set invite_only true to restrict it.)

alter table wa_plans add column if not exists billing_months int not null default 1;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'wa_plans_billing_months_check') then
    alter table wa_plans add constraint wa_plans_billing_months_check check (billing_months in (1, 3, 6, 12));
  end if;
end $$;
alter table wa_plans add column if not exists invite_only boolean not null default false;

create table if not exists wa_plan_grants (
  tenant_id  uuid not null references tenants(id) on delete cascade,
  plan_key   text not null,
  granted_by text,
  note       text,
  created_at timestamptz not null default now(),
  primary key (tenant_id, plan_key)
);
alter table wa_plan_grants enable row level security;

insert into wa_plans (key, name, price_cents, currency, interval, limits, features, sort, active, billing_months, invite_only)
select v.new_key, b.name || v.name_suffix, round(b.price_cents * 6 * v.factor)::int, b.currency, b.interval,
       b.limits, b.features, b.sort + v.sort_add, true, 6, true
  from wa_plans b
  join (values
    ('creator',     'creator-6m',             ' (6 months)',          0.90, 100),
    ('creator-pro', 'creator-pro-6m',         ' (6 months)',          0.90, 100),
    ('creator',     'creator-6m-partner',     ' (6 months, partner)', 0.80, 150),
    ('creator-pro', 'creator-pro-6m-partner', ' (6 months, partner)', 0.80, 150)
  ) as v(base_key, new_key, name_suffix, factor, sort_add) on v.base_key = b.key
on conflict (key) do nothing;
