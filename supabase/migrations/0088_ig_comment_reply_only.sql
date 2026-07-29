-- Reply-only comment automations for Instagram.
-- A comment rule can now be "reply only": on a matching comment it posts a
-- public reply (rotated from public_replies) and sends NO DM, no follow gate,
-- no link buttons. This powers a separate "Comment replies" system distinct
-- from the existing comment-to-DM rules. Existing rules default to false
-- (comment-to-DM behaviour unchanged).
alter table wa_ig_comment_rules
  add column if not exists reply_only boolean not null default false;
