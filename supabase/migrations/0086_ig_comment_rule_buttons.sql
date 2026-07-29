-- Multi-button support for Instagram comment-to-DM rules.
-- Meta's button template allows up to 3 buttons; previously a rule stored a
-- single button_label/button_url. This adds a `buttons` jsonb array of
-- {label,url} objects. The legacy button_label/button_url columns are kept in
-- sync with the FIRST button so old readers keep working during rollout.
alter table wa_ig_comment_rules
  add column if not exists buttons jsonb not null default '[]'::jsonb;
