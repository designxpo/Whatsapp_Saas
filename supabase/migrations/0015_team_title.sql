-- ── Team member title/persona ────────────────────────────────────────────────
-- A short role label (e.g. "Sales Counsellor", "Support Lead") set when adding
-- a member. Shown in the Live Chat "Assigned to" picker so it's easy to pick
-- the right person for a conversation.

alter table wa_users add column if not exists title text not null default '';
