-- Google Reviews Phase 2: a connected Google Business Profile location (Reviews
-- module). Reuses wa_channels (kind='google_reviews') the same way YouTube
-- reused it — the encrypted OAuth refresh token lives in access_token, and the
-- picked Business Profile location lives in these two new columns.

alter table wa_channels add column if not exists google_account_id text;
alter table wa_channels add column if not exists google_location_id text;
