-- Per-tenant payment webhook secrets.
--
-- Until now the Razorpay/Stripe webhook signature was verified against a single
-- platform-wide env secret, so payment confirmation only worked for the primary
-- account. In the own-payment-provider model every tenant connects their OWN
-- Razorpay/Stripe, creates a webhook in THEIR dashboard, and gets a signing
-- secret that only they know. That secret is stored here — ENCRYPTED, exactly
-- like the provider key in `secret` — so each tenant's payment webhook is
-- verified against their own secret. The webhook URL carries the integration id
-- (an unguessable UUID) which selects which tenant's secret to verify against.
alter table wa_integrations add column if not exists webhook_secret text;

comment on column wa_integrations.webhook_secret is
  'Encrypted provider webhook signing secret (Razorpay webhook secret / Stripe whsec_…). Used to verify inbound payment webhooks per-tenant. Never returned to the client.';
