-- YouTube comment automation (Module 1, Phase 1a). A third comment-automation
-- channel alongside Instagram & Facebook. YouTube has NO DMs → this is
-- public-reply + moderation only (maps to our "reply-only" mode). Ingestion is
-- POLL-based (no new-comment webhook exists), so we keep a per-channel cursor.
--
-- Additive & idempotent — safe to re-run. YouTube channels reuse wa_channels
-- (kind='youtube'); the connected channel id lives in a dedicated column and the
-- encrypted OAuth refresh token reuses wa_channels.access_token.

alter table wa_channels add column if not exists yt_channel_id text;

-- Rule-based public replies (reuse the shared keyword + rotating-reply engine).
create table if not exists wa_yt_comment_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default '00000000-0000-0000-0000-000000000001',
  channel_id uuid,                        -- wa_channels.id (the youtube channel)
  name text not null default '',
  enabled boolean not null default true,
  video_id text,                          -- null = all videos
  video_title text,
  video_thumbnail text,
  keyword text,                           -- comma-separated trigger words (blank = any)
  public_replies jsonb not null default '[]'::jsonb,   -- rotating reply variants
  moderate text not null default 'off',   -- off | hold_spam | reject_spam
  match_count int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_wa_yt_rules_tenant on wa_yt_comment_rules (tenant_id, created_at desc);
alter table wa_yt_comment_rules enable row level security;

-- Idempotency: one row per comment we've already acted on (survives poll overlap).
create table if not exists wa_yt_comment_log (
  comment_id text primary key,
  rule_id uuid,
  tenant_id uuid not null,
  created_at timestamptz not null default now()
);
alter table wa_yt_comment_log enable row level security;

-- Per-channel incremental poll cursor (quota-aware: only fetch comments newer
-- than the last successful poll).
create table if not exists wa_yt_poll_cursor (
  channel_id uuid primary key,
  tenant_id uuid not null,
  last_polled_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table wa_yt_poll_cursor enable row level security;
