-- Atomic webhook idempotency. Each inbound Meta event (WhatsApp message id,
-- Instagram message mid) is claimed by inserting its key here; the unique
-- primary key makes the claim race-free, so concurrent redeliveries can't
-- double-fire side effects (AI replies, sends, orders, sequence enrollment).
-- Prune old rows with a periodic job if desired.
create table if not exists wa_webhook_dedup (
  key text primary key,
  created_at timestamptz not null default now()
);
