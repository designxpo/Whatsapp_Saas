-- Widen the conversation platform to two new channels:
--   • messenger — Facebook Messenger (Meta Graph API, page-scoped PSIDs)
--   • webchat   — website live-chat widget (our own channel, visitor UUIDs)
-- Flows/sequences stay whatsapp/instagram-only (their own constraints unchanged).
alter table wa_conversations drop constraint if exists wa_conversations_platform_check;
alter table wa_conversations add constraint wa_conversations_platform_check
  check (platform in ('whatsapp', 'instagram', 'messenger', 'webchat'));
