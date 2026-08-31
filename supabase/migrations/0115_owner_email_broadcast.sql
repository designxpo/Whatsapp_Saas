-- 0115_owner_email_broadcast.sql — platform → tenant email campaigns
-- ("email all tenants"), the sending half of the Owner Console Emails section.
--
-- Deliberately mirrors the WhatsApp broadcast architecture already proven here
-- (wa_campaigns + wa_send_queue + claim_send_queue, 0001/0044) rather than
-- inventing a second pattern: a campaign header row, a per-recipient queue, and
-- an ATOMIC claim function. That last part is not optional — 0044's own comment
-- records what a non-atomic claim cost the internal build: "put 1,739 duplicate
-- marketing templates on real phones". The same mistake here means duplicate
-- announcements in every tenant's inbox.
--
-- No separate send-log table: sends go through sendEmail(), which already
-- writes wa_email_log (0114) and already gets delivered/opened/clicked/bounced
-- from the Resend webhook. campaign_id is added there instead, so one campaign's
-- real delivery outcomes are a filter on the log that already exists.

create table if not exists wa_owner_email_campaigns (
  id uuid primary key default gen_random_uuid(),
  subject text not null,
  -- 'simple' renders through renderEmail() (the same template every other
  -- platform email uses — safe across Outlook/Gmail without hand-testing);
  -- 'html' sends html_body verbatim for when a designed campaign is pasted in.
  mode text not null default 'simple' check (mode in ('simple', 'html')),
  heading text,
  body_paragraphs text[] not null default '{}',
  image_url text,
  cta_label text,
  cta_url text,
  html_body text,
  -- {mode:'all'|'active'|'trialing'|'suspended'} — resolved to owner emails at
  -- create time and frozen into the queue, so a tenant signing up mid-send
  -- doesn't silently join a campaign that was already reviewed and approved.
  audience jsonb not null default '{"mode":"all"}'::jsonb,
  status text not null default 'draft'
    check (status in ('draft', 'sending', 'sent', 'partial', 'failed', 'cancelled')),
  total_recipients int not null default 0,
  sent_count int not null default 0,
  failed_count int not null default 0,
  error_summary text,
  created_by text,                    -- owner email that composed it, for audit
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists woec_status_idx on wa_owner_email_campaigns (status, created_at desc);

create table if not exists wa_owner_email_queue (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references wa_owner_email_campaigns(id) on delete cascade,
  tenant_id uuid references tenants(id) on delete set null,
  to_email text not null,
  company text,                       -- snapshot, for {{company}} personalisation
  owner_name text,                    -- snapshot, for {{name}} personalisation
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'failed', 'skipped')),
  error text,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  -- One send per address per campaign, enforced by the database rather than by
  -- hoping the resolver de-duplicated (two tenants CAN share an owner email).
  unique (campaign_id, to_email)
);
create index if not exists woeq_claim_idx on wa_owner_email_queue (campaign_id, created_at) where status = 'pending';

-- Atomic claim, identical technique to claim_send_queue (0044): SKIP LOCKED so
-- overlapping cron ticks never grab the same recipient, and a claim older than
-- 10 minutes is reclaimable so a worker that died mid-send loses nothing.
create or replace function claim_owner_email_queue(p_campaign uuid, p_limit int)
returns table (id uuid, tenant_id uuid, to_email text, company text, owner_name text)
language sql
as $$
  update wa_owner_email_queue q
     set claimed_at = now()
   where q.id in (
     select s.id
       from wa_owner_email_queue s
      where s.campaign_id = p_campaign
        and s.status = 'pending'
        and (s.claimed_at is null or s.claimed_at < now() - interval '10 minutes')
      order by s.created_at
      limit p_limit
      for update skip locked
   )
  returning q.id, q.tenant_id, q.to_email, q.company, q.owner_name;
$$;

-- Ties a logged send back to the campaign that produced it, so the Emails log
-- doubles as any campaign's per-recipient delivery report.
alter table wa_email_log add column if not exists campaign_id uuid references wa_owner_email_campaigns(id) on delete set null;
create index if not exists wa_email_log_campaign_idx on wa_email_log (campaign_id) where campaign_id is not null;
