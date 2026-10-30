-- White-label, Phase 6: partners' own domains and email, and shared-quota caps.
--
-- custom_domain: the partner's own portal address (portal.theirbrand.com),
--   added to the Vercel project through its API; the portal answers there once
--   Vercel reports it verified.
-- email_domain: the partner's own sending domain in Resend
--   ({ id, name, status, records }); emails go from no-reply@<name> once verified.
-- yt_daily_cap: YouTube comment replies per day across all the partner's
--   workspaces (the YouTube quota is shared by every workspace on the platform).
--
-- Apply after 20261030180000_partner_billing.sql.

alter table wa_partners
  add column if not exists custom_domain text,
  add column if not exists domain_status text not null default 'none' check (domain_status in ('none', 'pending', 'verified', 'error')),
  add column if not exists domain_detail jsonb not null default '{}'::jsonb,
  add column if not exists email_domain jsonb not null default '{}'::jsonb,
  add column if not exists yt_daily_cap int not null default 300 check (yt_daily_cap >= 0);

create unique index if not exists wa_partners_custom_domain_uq on wa_partners (lower(custom_domain)) where custom_domain is not null;
