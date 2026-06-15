-- 0028_stripe_billing.sql — wire Stripe subscriptions into the plan/tenant model.
--
-- Each tenant gets a Stripe customer + (when subscribed) a subscription id, so
-- webhooks can map a Stripe event back to the right tenant. Each plan maps to a
-- Stripe Price (the owner sets the price id in the Plans editor). The existing
-- payment_status / plan / current_period_end / amount_cents columns (0024) are
-- now driven by Stripe webhooks instead of manual owner toggles.

alter table tenants add column if not exists stripe_customer_id     text;
alter table tenants add column if not exists stripe_subscription_id text;

-- Fast reverse lookup from a webhook (customer/subscription → tenant).
create unique index if not exists tenants_stripe_customer_idx
  on tenants (stripe_customer_id) where stripe_customer_id is not null;
create unique index if not exists tenants_stripe_subscription_idx
  on tenants (stripe_subscription_id) where stripe_subscription_id is not null;

-- Map each plan to a Stripe Price (e.g. price_123). Null → plan not purchasable
-- via Stripe yet (owner hasn't connected it).
alter table wa_plans add column if not exists stripe_price_id text;
