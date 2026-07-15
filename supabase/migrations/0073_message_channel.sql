-- Multi-number observability. With several WhatsApp numbers on one workspace, a
-- customer can message different numbers and everything merges into their one
-- conversation (keyed by their phone) — with no record of WHICH number each
-- message arrived on or went out from, and the contact carries no trace of the
-- number that produced the lead.
--
-- wa_conv_messages.channel_id: the number/account a message came in on (inbound)
-- or was sent from (outbound). Null on legacy rows.
-- contacts.channel_id: first-touch attribution — the channel that produced the
-- lead, stamped once at contact creation and never overwritten.
-- Columns are tenant-neutral; rows stay tenant-scoped as before.

alter table wa_conv_messages add column if not exists channel_id uuid references wa_channels(id) on delete set null;
alter table contacts add column if not exists channel_id uuid references wa_channels(id) on delete set null;

comment on column wa_conv_messages.channel_id is
  'Channel (number/account) this message arrived on / was sent from. Null = unknown (legacy row).';
comment on column contacts.channel_id is
  'First-touch channel that produced this lead. Stamped at creation, never overwritten.';
