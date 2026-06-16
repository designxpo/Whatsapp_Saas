-- 0041_channel_quality.sql — persist each WhatsApp number's Meta health so the
-- send paths can auto-pause when quality drops. Previously quality_rating was
-- only fetched for UI display and never gated sending, so a number going RED /
-- FLAGGED kept broadcasting at full volume — exactly what escalates RED → number
-- disabled. These columns let the broadcast drainer stop marketing on a bad number.

alter table wa_channels add column if not exists quality_rating   text;          -- GREEN | YELLOW | RED | UNKNOWN
alter table wa_channels add column if not exists messaging_health  text;          -- AVAILABLE | FLAGGED | RESTRICTED (from phone_number_quality_update.event)
alter table wa_channels add column if not exists quality_event     text;          -- last raw webhook event (FLAGGED/UNFLAGGED/…)
alter table wa_channels add column if not exists quality_updated_at timestamptz;
-- Auto-pause flag: set true when health goes FLAGGED/RESTRICTED or quality RED;
-- the broadcast drainer refuses MARKETING sends on this channel while true. An
-- admin (or an UNFLAGGED/UPGRADE webhook) can clear it.
alter table wa_channels add column if not exists marketing_paused  boolean not null default false;
