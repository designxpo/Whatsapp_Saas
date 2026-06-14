-- Inbox parity + campaign intelligence (PLATFORM-PLAN.md Phases 2-3).

-- Canned responses for agents (admin inbox + CRM chat panel).
create table if not exists wa_quick_replies (
  id uuid primary key default gen_random_uuid(),
  shortcut text not null unique,          -- e.g. "fees", "location"
  body text not null,
  created_at timestamptz not null default now()
);

-- Simple key/value settings store (welcome message, working hours, away message).
create table if not exists wa_settings (
  key text primary key,
  value jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

-- Conversation labels + agent assignment + welcome-message tracking.
alter table wa_conversations add column if not exists labels text[] not null default '{}';
alter table wa_conversations add column if not exists assigned_to text;
alter table wa_conversations add column if not exists welcomed boolean not null default false;
create index if not exists wa_conversations_labels_idx on wa_conversations using gin (labels);

-- Retarget queries filter by campaign + delivery status.
create index if not exists wsl_campaign_status_idx on wa_send_log (campaign_id, status);
