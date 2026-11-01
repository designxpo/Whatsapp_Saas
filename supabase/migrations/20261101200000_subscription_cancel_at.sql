-- When a workspace's subscription has been told NOT to renew.
--
-- A customer can cancel from the billing page (Razorpay: cancel at the end of
-- the current cycle; Stripe: the billing portal). Cancelling stops renewals but
-- keeps the plan active until the paid period ends, so the billing page needs
-- to say "active until <date>, won't renew" — and nothing on `tenants` records
-- that today: payment_status only changes when the period actually ends.
--
-- NULL = renews as normal. A timestamp = the moment access ends and no further
-- charge is taken. The app tolerates this column being absent (it falls back
-- to the wa_owner_audit row the cancel route also writes), so applying this
-- after the deploy is safe.
alter table tenants add column if not exists subscription_cancel_at timestamptz;

comment on column tenants.subscription_cancel_at is
  'Subscription set not to renew; plan stays active until this time. NULL = renews normally.';
