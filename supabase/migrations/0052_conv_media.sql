-- Inbound media (e.g. WhatsApp/Instagram voice notes) attached to a conversation
-- message, so Live Chat can play the original audio alongside its transcript.
-- Additive + nullable: existing rows and any pre-migration inserts keep working
-- (the app retries the insert without these columns if they're not present yet).
alter table wa_conv_messages add column if not exists media_url text;
alter table wa_conv_messages add column if not exists media_type text;
