-- 0034_conv_avatar.sql — store a conversation's profile image (Instagram only;
-- WhatsApp Cloud API doesn't expose profile photos). Shown in Live Chat.
alter table wa_conversations add column if not exists avatar_url text;
