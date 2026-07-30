-- Allow the youtube + google_reviews channel KINDS on wa_channels.
--
-- The wa_channels.kind CHECK constraint (0055) only allowed whatsapp,
-- instagram, messenger, webchat — so every attempt to save a YouTube channel
-- or a Google Reviews connection has been failing with a constraint
-- violation ("gr_error=save_failed" / the equivalent on the YouTube side).
-- Widen it to match. Additive + idempotent.
alter table wa_channels drop constraint if exists wa_channels_kind_check;
alter table wa_channels add constraint wa_channels_kind_check
  check (kind in ('whatsapp', 'instagram', 'messenger', 'webchat', 'youtube', 'google_reviews'));
