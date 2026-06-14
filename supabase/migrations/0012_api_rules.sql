-- ── API broadcasting rules engine ─────────────────────────────────────────────
-- External systems fire ONE generic event (POST /api/events with an event name
-- + free-form data payload). Rules defined in the portal decide what to send,
-- to whom, and when: payload/contact conditions, template variable mapping,
-- delay, allowed send window, and a per-contact frequency cap.

create table if not exists wa_api_rules (
  id                  uuid primary key default gen_random_uuid(),
  campaign_id         uuid references wa_campaigns(id) on delete set null,  -- hidden campaign: logging + funnel/click analytics
  name                text not null,
  active              boolean not null default true,
  event_key           text not null,
  conditions          jsonb not null default '[]'::jsonb,  -- [{source:'payload'|'contact_attr'|'contact_tag'|'contact_field', key, op, value}]
  template_name       text not null,
  language_code       text not null default 'en_US',
  variables           jsonb not null default '[]'::jsonb,  -- ["{{payload.course}}", "{{contact.name}}", "literal", …]
  header_image_url    text,
  delay_value         int not null default 0,
  delay_unit          text not null default 'minutes' check (delay_unit in ('minutes','hours','days')),
  window_start_hour   int check (window_start_hour between 0 and 23),  -- allowed send window (IST); null = anytime
  window_end_hour     int check (window_end_hour between 1 and 24),
  frequency_cap_hours int not null default 0,               -- skip if this rule already messaged the contact within N hours (0 = off)
  created_at          timestamptz not null default now()
);
create index if not exists war_event_idx on wa_api_rules (event_key) where active;

-- Per-recipient scheduled sends minted by rules (variables resolved at event time).
create table if not exists wa_rule_sends (
  id             uuid primary key default gen_random_uuid(),
  rule_id        uuid not null references wa_api_rules(id) on delete cascade,
  phone          text not null,
  recipient_name text not null default '',
  variables      jsonb not null default '[]'::jsonb,
  payload        jsonb not null default '{}'::jsonb,
  send_after     timestamptz not null default now(),
  status         text not null default 'pending'
                   check (status in ('pending','sending','sent','skipped','failed','cancelled')),
  detail         text,
  created_at     timestamptz not null default now(),
  processed_at   timestamptz
);
create index if not exists wrs_due_idx on wa_rule_sends (send_after) where status = 'pending';
create index if not exists wrs_cap_idx on wa_rule_sends (rule_id, phone, created_at);
