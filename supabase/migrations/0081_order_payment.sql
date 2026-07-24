-- Order payment confirmation: when a payment-provider webhook (Razorpay/Stripe)
-- reports a pay link as paid, we flip the matching wa_orders row pending → paid.
-- Record WHEN it was confirmed and WHICH provider, for audit + fulfilment.
alter table wa_orders add column if not exists paid_at   timestamptz;
alter table wa_orders add column if not exists provider  text;

-- The webhook reconciles by payment_ref (the provider's hosted-link id, which
-- checkoutCart() already stores). Index it for the lookup.
create index if not exists wa_orders_payment_ref_idx on wa_orders (payment_ref);
