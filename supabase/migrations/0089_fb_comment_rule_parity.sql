-- Bring Facebook comment rules to parity with Instagram:
--   • buttons        jsonb  — up to 3 link buttons (Meta button-template cap)
--   • public_replies jsonb  — rotating public-reply variants (anti-spam variation)
--   • reply_only     bool   — post a public reply only, never a DM
--   • like_comment   bool   — like the comment (as the Page) when the rule fires
-- Legacy button_label/button_url/public_reply stay in sync with variant[0] for
-- old readers. Existing rules keep their comment-to-DM behaviour (reply_only=false).
alter table wa_fb_comment_rules
  add column if not exists buttons jsonb not null default '[]'::jsonb,
  add column if not exists public_replies jsonb not null default '[]'::jsonb,
  add column if not exists reply_only boolean not null default false,
  add column if not exists like_comment boolean not null default false;
