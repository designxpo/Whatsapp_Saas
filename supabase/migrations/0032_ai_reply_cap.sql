-- 0032_ai_reply_cap.sql — cap AI auto-replies per conversation.
-- After N AI replies the bot hands off to a human (escalates) instead of
-- replying forever. Counts AI replies (DM + comment-AI) per conversation.
alter table wa_conversations add column if not exists ai_reply_count int not null default 0;
