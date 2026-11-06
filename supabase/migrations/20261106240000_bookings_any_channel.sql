-- Bookings from every chat channel, and from Mezvaan.
--
-- channel: where the customer booked (WhatsApp, Instagram, Messenger, web
--   chat). Only WhatsApp bookings get WhatsApp reminders; the others are
--   still recorded, confirmed and closed like any booking.
-- conversation_id: the chat the booking came from, so it opens from Bookings
--   even when the customer has no WhatsApp number (Instagram, web chat).
-- source 'mezvaan': restaurant table reservations from the Mezvaan link.

alter table wa_bookings add column if not exists channel text not null default 'whatsapp';
alter table wa_bookings drop constraint if exists wa_bookings_channel_check;
alter table wa_bookings add constraint wa_bookings_channel_check check (channel in ('whatsapp','instagram','messenger','webchat'));
alter table wa_bookings add column if not exists conversation_id uuid references wa_conversations(id) on delete set null;
alter table wa_bookings drop constraint if exists wa_bookings_source_check;
alter table wa_bookings add constraint wa_bookings_source_check check (source in ('manual','google_calendar','calcom','calendly','mezvaan'));
