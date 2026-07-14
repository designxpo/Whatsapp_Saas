-- Per-channel knowledge allocation: a WhatsApp number / IG account / FB Page /
-- web-chat widget can be pinned to one KB topic tag, so the AI on that channel
-- answers from those docs first (falling back to the whole tenant KB only when
-- the tagged docs don't cover the question — same semantics flows already use).
--
-- Precedence at reply time: conversation's flow-stamped primary_kb_tag
-- → channel's kb_tag → tenant-global (all docs). Mirrors the existing agent
-- chain (conversation agent_id → channel agent_id → the tenant's active agent).

alter table wa_channels add column if not exists kb_tag text;

comment on column wa_channels.kb_tag is
  'Default KB topic tag for AI answers on this channel; null = the tenant''s whole knowledge base';
