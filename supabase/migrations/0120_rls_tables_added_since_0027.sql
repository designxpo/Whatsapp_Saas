-- Row Level Security for the tables added since 0027.
--
-- ── What the earlier migrations did, and the gap they left ────────────────
--
-- 0019 and 0027 enabled RLS across the schema with a loop:
--
--   execute format('alter table public.%I enable row level security;', t);
--
-- A loop covers what exists when it runs. Ninety-odd migrations later, the
-- tables created since have RLS only where somebody remembered — most did,
-- these did not. Nothing announced it, because every server path connects as
-- the service role, which has BYPASSRLS.
--
-- ── Why it matters in a MULTI-TENANT product specifically ─────────────────
--
-- RLS here is deny-by-default for the anon and authenticated roles behind the
-- public PostgREST API: with RLS on and no permissive policy, a direct REST
-- call with the project's public anon key returns zero rows. With RLS off and
-- a grant in place, it returns the table — and in this product a table is not
-- one business's data, it is everybody's.
--
-- The list below is why that is not theoretical:
--
--   wa_user_passkeys        authentication material
--   wa_login_attempts       the throttle's own record
--   wa_affiliates,
--   wa_affiliate_commissions  who earns what
--   wa_billing_events,
--   wa_invoice_counters     revenue
--   tenant_metrics          every tenant's usage, in one table
--   meta_deletion_requests  GDPR obligations
--
-- This changes no application behaviour: every write path is service-role.
--
-- ── Deliberately NOT here ──────────────────────────────────────────────────
--
-- wa_rate_limits — platform infrastructure, not tenant data. A confined client
-- would read zero hits and the limiter would silently stop limiting. 0119 says
-- the same; a security control that fails by doing nothing is worse than none,
-- because it looks present.

-- Authentication and anti-abuse.
alter table wa_user_passkeys        enable row level security;
alter table wa_login_attempts       enable row level security;

-- Money.
alter table wa_affiliates           enable row level security;
alter table wa_affiliate_commissions enable row level security;
alter table wa_billing_events       enable row level security;
alter table wa_invoice_counters     enable row level security;

-- Cross-tenant operational data.
alter table tenant_metrics          enable row level security;
alter table wa_platform_flags       enable row level security;
alter table wa_owner_email_campaigns enable row level security;
alter table wa_owner_email_queue    enable row level security;
alter table wa_email_log            enable row level security;
alter table wa_moderation_log       enable row level security;
alter table wa_batches              enable row level security;
alter table wa_webhook_dedup        enable row level security;

-- Legal obligations.
alter table meta_deletion_requests  enable row level security;

comment on table wa_rate_limits is
  'Fixed-window request counters. Platform-level: NO row level security, by design — see 0119 and 0120.';
