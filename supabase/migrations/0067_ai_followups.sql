-- ── AI follow-ups (re-engage a lead who went quiet) ─────────────────────────
-- When WE sent the last message (often a question) and the customer never
-- replied, a cron-driven worker composes ONE short, context-aware AI nudge and
-- sends it — but ONLY inside the 24h messaging window (free-form is blocked
-- after that on WhatsApp/Instagram/Messenger). These two columns track how many
-- nudges we've sent in the current silent stretch so we never over-nudge; both
-- reset to 0/null the moment the customer sends a new inbound (touchInbound).
--
-- wa_conversations is already tenant-scoped (tenant_id + RLS from 0019/0029), so
-- this only adds two columns + one index. Per-tenant tunables (enable, delay,
-- max attempts) live in wa_settings — no schema needed for those.
--
-- Idempotent and additive: safe to run before the code that writes them ships
-- (they simply stay at the defaults until then).

alter table wa_conversations add column if not exists followup_count   int not null default 0;       -- AI nudges sent in the current quiet stretch
alter table wa_conversations add column if not exists last_followup_at timestamptz;                  -- when the last AI nudge went out (null = none this stretch)

-- The drain scans for chats where the bot spoke last and has gone quiet; a
-- partial index on the outbound timestamp keeps that sweep cheap as volume grows.
create index if not exists wa_conversations_followup_idx
  on wa_conversations (last_outbound_at)
  where bot_enabled = true;
