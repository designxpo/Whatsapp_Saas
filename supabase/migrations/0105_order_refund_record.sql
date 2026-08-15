-- Refunds are RECORDED here, never issued by us: the brand refunds in their own
-- Razorpay/Stripe dashboard, then logs the gateway's refund id + amount against
-- the order so money and order state stay reconcilable (see 0083).
-- provider_payment_id is the gateway PAYMENT (pay_… / pi_…) the pay-webhook
-- confirmed — the thing a refund is actually issued against, and until now the
-- one id we threw away.
alter table wa_orders add column if not exists provider_payment_id text;
alter table wa_orders add column if not exists refunded_at         timestamptz;
alter table wa_orders add column if not exists refund_ref          text;
alter table wa_orders add column if not exists refund_amount_cents int;
alter table wa_orders add column if not exists refund_note         text;
