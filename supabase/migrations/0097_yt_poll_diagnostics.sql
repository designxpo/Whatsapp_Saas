-- YouTube poller diagnostics. The poller was a black box: it reported a count
-- and discarded YouTube's actual response, so "the reply didn't appear" was
-- impossible to tell apart from "YouTube accepted it and held it for review".
-- These columns record the last outcome per channel so the portal can show it.

alter table wa_yt_poll_cursor add column if not exists last_checked_at timestamptz;
alter table wa_yt_poll_cursor add column if not exists last_reply_at   timestamptz;
alter table wa_yt_poll_cursor add column if not exists last_reply_id   text;   -- YouTube comment id of our reply — look it up to prove it exists
alter table wa_yt_poll_cursor add column if not exists last_error      text;
alter table wa_yt_poll_cursor add column if not exists replies_posted  int not null default 0;
alter table wa_yt_poll_cursor add column if not exists comments_seen   int not null default 0;
