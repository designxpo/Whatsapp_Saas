-- Knowledge-base auto-sync. URL-sourced documents are re-crawled on a schedule
-- and re-embedded only when the page content actually changed. We track a content
-- hash (to detect changes cheaply) and the last sync time (to decide what's due).
-- Both columns are nullable; the app degrades to "always re-ingest" if absent.
alter table kb_documents add column if not exists content_hash text;
alter table kb_documents add column if not exists last_synced_at timestamptz;
