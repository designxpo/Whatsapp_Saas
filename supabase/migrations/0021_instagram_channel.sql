-- 0021_instagram_channel.sql — Instagram as a channel (multi-channel).
--
-- IG Messaging API shares Meta Graph API + webhooks + the channel-agnostic flow
-- engine, so Instagram is a CHANNEL KIND, not a new product. A connected IG
-- professional account is a wa_channels row with kind='instagram'.
--
-- Conversations are reused: for IG, wa_conversations.phone holds the IGSID
-- (Instagram-scoped user id) and platform='instagram'. last_inbound_at already
-- exists and is what the 24-hour messaging-window guard reads.

-- WA-only columns become nullable so IG channels (no phone/WABA) can be stored.
alter table wa_channels alter column phone_number_id drop not null;
alter table wa_channels alter column waba_id drop not null;

alter table wa_channels add column if not exists kind text not null default 'whatsapp'
  check (kind in ('whatsapp','instagram'));
alter table wa_channels add column if not exists ig_user_id text;   -- IG professional account id (used in /{ig-id}/messages)
alter table wa_channels add column if not exists page_id text;      -- connected Facebook Page id

-- One channel per IG account (global, like a phone number id).
create unique index if not exists wa_channels_ig_user_idx
  on wa_channels (ig_user_id) where ig_user_id is not null;

-- Distinguish IG vs WA conversations quickly.
alter table wa_conversations add column if not exists platform text not null default 'whatsapp'
  check (platform in ('whatsapp','instagram'));
