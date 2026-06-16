-- 0042_channel_tier.sql — persist each number's Meta messaging-limit tier so the
-- broadcast drainer can cap against the number's REAL per-24h allowance instead
-- of one global WA_DAILY_LIMIT env constant. A fresh number on the 250/day tier
-- would otherwise be allowed to send up to the global cap and trip a Meta block.

alter table wa_channels add column if not exists messaging_tier   text;          -- TIER_250 | TIER_1K | TIER_10K | TIER_100K | TIER_UNLIMITED
alter table wa_channels add column if not exists tier_updated_at  timestamptz;
