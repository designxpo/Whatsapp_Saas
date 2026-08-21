-- 0109_billing_gst_fees.sql — GST (18%, GST-exclusive prices) and an
-- estimated Razorpay gateway-fee gross-up (2% + 18% GST on that fee = 2.36%
-- effective) added on top of a plan's base price at checkout. tenants.amount_cents
-- becomes the TRUE TOTAL CHARGED (base + tax + fee estimate) so existing MRR/
-- revenue call sites (platformStats, owner_platform_stats(), the Revenue page)
-- keep reporting real cash collected with zero code changes; the breakdown
-- lives in these new columns/table for invoicing and accurate net-revenue
-- reporting once the real post-charge fee is known.

alter table tenants add column if not exists base_amount_cents int;
alter table tenants add column if not exists tax_cents int;
alter table tenants add column if not exists gateway_fee_estimate_cents int;

-- One row per charge (every renewal, not just the first payment) — the
-- durable, itemized record. gateway_fee_actual_cents/gateway_tax_actual_cents
-- start null and get filled in by the subscription.charged webhook once
-- Razorpay reports the real fee for that specific payment.
create table if not exists wa_billing_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  provider text not null check (provider in ('stripe', 'razorpay')),
  provider_payment_id text,
  base_amount_cents int not null,
  tax_cents int not null,
  gateway_fee_estimate_cents int not null,
  gateway_fee_actual_cents int,
  gateway_tax_actual_cents int,
  total_charged_cents int not null,
  currency text not null default 'INR',
  created_at timestamptz not null default now()
);
create index if not exists wa_billing_events_tenant_idx on wa_billing_events (tenant_id, created_at desc);
create index if not exists wa_billing_events_payment_idx on wa_billing_events (provider_payment_id) where provider_payment_id is not null;
