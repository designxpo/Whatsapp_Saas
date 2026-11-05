-- Turning a chat's bot back on after the team has gone quiet (lib/botresume.ts).
--
--   bot_off_at      when the bot was last turned off; the sweep waits until this
--                   AND the last message sent are older than the workspace's setting.
--   bot_resumed_at  when the sweep turned it back on. Until the customer writes
--                   again, AI follow-ups and inactivity drips leave the chat alone.
--
-- Safe to re-run.

alter table wa_conversations add column if not exists bot_off_at timestamptz;
alter table wa_conversations add column if not exists bot_resumed_at timestamptz;

update wa_conversations
   set bot_off_at = coalesce(last_outbound_at, last_inbound_at, created_at)
 where bot_enabled = false and bot_off_at is null;

create index if not exists wa_conversations_bot_off_idx
  on wa_conversations (tenant_id, bot_off_at) where bot_enabled = false;
