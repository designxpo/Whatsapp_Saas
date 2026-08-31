-- 0114_email_log.sql — a durable record of every platform email, for the new
-- Owner Console "Emails" panel: what was sent, to whom, of what type, and its
-- delivery lifecycle (sent → delivered → opened/clicked, or bounced/
-- complained/failed). None of this existed before — sendEmail() called Resend
-- and threw the result away, so there was no way to answer "did the dunning
-- email even go out" short of checking the Resend dashboard by hand.
--
-- One row per send. tenant_id is nullable — the contact form and a few
-- platform-level notices have no tenant to attribute to.

create table if not exists wa_email_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete set null,
  email_type text not null,          -- 'otp' | 'invoice' | 'dunning_failed' | 'dunning_suspended' |
                                      -- 'weekly_recap' | 'onboarding_nudge' | 'affiliate_commission' |
                                      -- 'contact_form' | 'other'
  to_email text not null,
  subject text not null,
  resend_id text,                    -- Resend's message id — how the webhook below finds this row again
  status text not null default 'sent'
    check (status in ('sent','delivered','delayed','opened','clicked','bounced','complained','failed')),
  error text,                        -- set when the send itself failed (status='failed')
  sent_at timestamptz not null default now(),
  delivered_at timestamptz,
  opened_at timestamptz,
  clicked_at timestamptz,
  bounced_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists wa_email_log_sent_at_idx on wa_email_log (sent_at desc);
create index if not exists wa_email_log_tenant_idx on wa_email_log (tenant_id, sent_at desc);
create index if not exists wa_email_log_type_idx on wa_email_log (email_type, sent_at desc);
-- The webhook's only lookup: find the row for this Resend message id. Partial
-- (WHERE resend_id IS NOT NULL) since a failed send never gets one.
create index if not exists wa_email_log_resend_id_idx on wa_email_log (resend_id) where resend_id is not null;
