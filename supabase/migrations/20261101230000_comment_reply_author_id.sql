-- 20261101230000_comment_reply_author_id.sql — who wrote the comment we
-- answered, by their platform id (Instagram-scoped id, Facebook page-scoped id,
-- YouTube channel id), so "Replies sent" can show the person and open their chat.
--
-- Empty string = looked up and not found (so the background fill doesn't ask
-- again); NULL = not looked up yet.
--
-- Idempotent: safe to run twice.

alter table wa_comment_replies add column if not exists comment_author_id text;
create index if not exists wa_comment_replies_author_fill_idx on wa_comment_replies (created_at desc) where comment_author_id is null;
