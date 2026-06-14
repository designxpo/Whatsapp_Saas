-- WhatsApp Broadcaster — initial schema (standalone; new Supabase project).
-- Contacts are imported via CSV / pushed via API (no registration/OTP flow).

create extension if not exists pgcrypto;

-- ── Contacts ────────────────────────────────────────────────────────────────
create table if not exists contacts (
  id          uuid primary key default gen_random_uuid(),
  phone       text not null,                    -- digits, country-coded (e.g. 9198…)
  name        text not null default '',
  email       text,
  tags        text[] not null default '{}',     -- free-form segments
  status      text not null default 'active' check (status in ('active','optedout')),
  source      text,                             -- 'import' | 'api' | 'manual'
  created_at  timestamptz not null default now(),
  unique (phone)
);
create index if not exists contacts_tags_idx on contacts using gin (tags);
create index if not exists contacts_status_idx on contacts (status);

-- ── Opt-outs (authoritative suppression list; also flips contacts.status) ────
create table if not exists wa_optouts (
  phone      text primary key,                  -- last-10 or full digits
  reason     text,
  created_at timestamptz not null default now()
);

-- ── Campaigns (also used as auto-send config when auto_send_enabled) ─────────
create table if not exists wa_campaigns (
  id                uuid primary key default gen_random_uuid(),
  name              text,
  template_name     text not null,
  language_code     text not null default 'en_US',
  variables         jsonb not null default '[]',
  header_image_url  text,
  audience          jsonb,                       -- {mode:'all'|'tag'|'recipients', tag?:string}
  status            text not null default 'draft'
                      check (status in ('draft','scheduled','sending','sent','partial','failed')),
  total_recipients  int not null default 0,
  sent_count        int not null default 0,
  failed_count      int not null default 0,
  error_summary     text,
  scheduled_for     timestamptz,
  auto_send_enabled boolean not null default false,
  auto_send_trigger text check (auto_send_trigger in ('contact_added','tag_added','api_event')),
  trigger_key       text,                         -- e.g. the tag or event name that fires it
  delay_value       int not null default 0,
  delay_unit        text not null default 'minutes' check (delay_unit in ('minutes','hours','days')),
  created_at        timestamptz not null default now(),
  sent_at           timestamptz
);
create index if not exists wac_autosend_idx on wa_campaigns (auto_send_trigger, trigger_key) where auto_send_enabled;
create index if not exists wac_scheduled_idx on wa_campaigns (scheduled_for) where status = 'scheduled';

-- ── Per-recipient send queue (background drain) ──────────────────────────────
create table if not exists wa_send_queue (
  id             uuid primary key default gen_random_uuid(),
  campaign_id    uuid not null references wa_campaigns(id) on delete cascade,
  phone          text not null,
  recipient_name text not null default '',
  status         text not null default 'pending'
                   check (status in ('pending','sent','failed','skipped','cancelled')),
  error          text,
  created_at     timestamptz not null default now(),
  processed_at   timestamptz,
  unique (campaign_id, phone)
);
create index if not exists wsq_pending_idx on wa_send_queue (campaign_id) where status = 'pending';

-- ── Per-recipient send log (delivery/read tracking + dedup) ──────────────────
create table if not exists wa_send_log (
  id              uuid primary key default gen_random_uuid(),
  campaign_id     uuid references wa_campaigns(id) on delete cascade,
  phone           text not null,
  recipient_name  text not null default '',
  status          text not null default 'sent'
                    check (status in ('sent','delivered','read','failed','skipped')),
  error_detail    text,
  meta_message_id text,
  sent_at         timestamptz not null default now(),
  delivered_at    timestamptz,
  read_at         timestamptz
);
create index if not exists wsl_campaign_idx on wa_send_log (campaign_id);
create index if not exists wsl_msgid_idx on wa_send_log (meta_message_id);

-- ── Event-triggered scheduled sends (auto-sends) ─────────────────────────────
create table if not exists wa_scheduled_sends (
  id             uuid primary key default gen_random_uuid(),
  campaign_id    uuid not null references wa_campaigns(id) on delete cascade,
  contact_id     uuid references contacts(id) on delete set null,
  phone          text not null,
  recipient_name text not null default '',
  trigger        text not null,
  send_after     timestamptz not null,
  status         text not null default 'pending'
                   check (status in ('pending','sent','skipped','cancelled','failed')),
  error          text,
  created_at     timestamptz not null default now(),
  processed_at   timestamptz
);
create index if not exists wss_due_idx on wa_scheduled_sends (send_after) where status = 'pending';
