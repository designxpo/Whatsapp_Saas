-- A real phone number captured for a conversation whose own identifier isn't a
-- phone (Instagram uses an IGSID). Lets Instagram conversations be matched to a
-- CRM lead by the phone the lead shares in chat. Nullable; code degrades to
-- handle-matching when absent.
alter table wa_conversations add column if not exists lead_phone text;
