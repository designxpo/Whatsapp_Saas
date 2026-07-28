-- Per-Instagram-account toggle: may the AI publicly reply to comments that don't
-- match a fixed comment-to-DM rule? Default TRUE preserves current behaviour
-- (AI answers un-ruled comments). Turn OFF to leave such comments untouched.
-- Additive + idempotent.
alter table wa_channels add column if not exists comment_ai boolean not null default true;
