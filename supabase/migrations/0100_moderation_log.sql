-- 0099_moderation_log.sql — audit trail for content the safety layer blocked.
--
-- Every block is recorded so a tenant/owner can see WHAT was stopped and why,
-- rather than content silently vanishing (a false positive with no trace is
-- indistinguishable from a bug). Read-heavy is not expected; this is an
-- append-only incident log, pruned by the cron's housekeeping sweep.

create table if not exists wa_moderation_log (
  id uuid primary key default gen_random_uuid(),
  -- Nullable: the low-level channel senders (instagram.ts, youtube.ts, …) are
  -- the last-line backstop and don't carry a tenant in their creds. Blocks
  -- caught upstream — AI replies, save-time validation, uploads — do record
  -- one, so per-tenant review still works for everything with a known owner.
  tenant_id uuid,
  -- Where in the product this was caught: ai_reply | comment_reply | dm_reply
  -- | review_reply | upload | product_image | broadcast_media | flow_text
  -- | quick_reply | sequence_text | comment_rule
  surface text not null,
  kind text not null default 'text',        -- text | image
  -- Why it was blocked: the moderation categories that tripped, comma-joined
  -- (e.g. "harassment,hate") or "keyword:<term>" for the local pre-filter.
  reason text not null,
  -- Truncated excerpt / the media URL — enough to review the decision without
  -- storing an unbounded payload.
  excerpt text,
  created_at timestamptz not null default now()
);

create index if not exists wa_moderation_log_tenant_idx
  on wa_moderation_log (tenant_id, created_at desc);
