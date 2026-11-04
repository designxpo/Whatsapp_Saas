-- Preserve the original DM-first follow gate for existing rules. Comment-first
-- verification is a separate, explicitly selected delivery mode.
alter table public.wa_ig_comment_rules
  add column follow_check_mode text not null default 'dm'
  check (follow_check_mode in ('dm', 'comment'));

comment on column public.wa_ig_comment_rules.follow_check_mode is
  'dm: send the opening follow prompt privately; comment: check before DM, otherwise post follow + DM instructions. require_follow=false bypasses both.';
