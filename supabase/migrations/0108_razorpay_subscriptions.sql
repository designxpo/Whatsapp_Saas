-- 0108_razorpay_subscriptions.sql — Razorpay as a real self-serve billing
-- provider (Razorpay Subscriptions — recurring, not one-time Standard
-- Checkout). Stripe's columns/logic are untouched; this adds Razorpay's
-- equivalents alongside them, plus a payment_provider marker so
-- applySubscription()/webhooks/the billing UI know which provider owns a
-- given tenant's active subscription.

alter table wa_plans add column if not exists razorpay_plan_id text;
create index if not exists wa_plans_razorpay_plan_idx on wa_plans (razorpay_plan_id) where razorpay_plan_id is not null;

alter table tenants add column if not exists razorpay_customer_id text;
alter table tenants add column if not exists razorpay_subscription_id text;
alter table tenants add column if not exists payment_provider text
  check (payment_provider is null or payment_provider in ('stripe', 'razorpay'));
create index if not exists tenants_razorpay_subscription_idx on tenants (razorpay_subscription_id) where razorpay_subscription_id is not null;
