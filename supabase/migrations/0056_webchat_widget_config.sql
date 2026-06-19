-- Web-chat widget look & feel (colour, header title, welcome greeting, position).
-- Stored as JSON on the channel so the embed loader can theme the bubble per
-- widget. Additive + idempotent; empty {} = the built-in defaults.
alter table wa_channels add column if not exists widget_config jsonb not null default '{}'::jsonb;
