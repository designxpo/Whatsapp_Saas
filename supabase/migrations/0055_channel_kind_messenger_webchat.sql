-- Allow the messenger + webchat channel KINDS on wa_channels.
--
-- 0053 widened wa_conversations.platform and 0054 added the web-chat columns, but
-- the wa_channels.kind CHECK constraint (from 0021) still only allowed
-- whatsapp+instagram — so saving a Messenger Page or web-chat widget failed with a
-- constraint violation. Widen it to match. Additive + idempotent.
alter table wa_channels drop constraint if exists wa_channels_kind_check;
alter table wa_channels add constraint wa_channels_kind_check
  check (kind in ('whatsapp', 'instagram', 'messenger', 'webchat'));
