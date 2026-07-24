-- Allow orders to be marked 'refunded' from the order admin. This is a tracked
-- status (the brand issues the actual refund in their Razorpay/Stripe dashboard,
-- then records it here) — we don't call the gateway refund API automatically.
alter table wa_orders drop constraint if exists wa_orders_status_check;
alter table wa_orders add constraint wa_orders_status_check
  check (status in ('pending','paid','fulfilled','cancelled','refunded'));

-- Newest-first listing per tenant is the default order-admin query.
create index if not exists wa_orders_tenant_created_idx on wa_orders (tenant_id, created_at desc);
