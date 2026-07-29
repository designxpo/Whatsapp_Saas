-- Rotating public-reply variants for Instagram comment rules.
-- Sending the SAME public reply on every comment is a strong spam/automation
-- signal to Instagram. A rule can now hold several public-reply variants
-- (jsonb array of strings); the webhook picks one at random per comment so no
-- two replies look identical. The legacy single public_reply column is kept in
-- sync with the first variant for old readers during rollout.
alter table wa_ig_comment_rules
  add column if not exists public_replies jsonb not null default '[]'::jsonb;
