-- ── Per-channel automation mode ───────────────────────────────────────────────
-- Counselor 1:1 numbers must stay clean: no AI reply, chatbot flow, welcome/away
-- notice, keyword/inactivity sequence, or AI follow-up ever fires on them. They
-- send only what a human or a canned template pushes from the portal.
--
--   mode = 'full'   (default) — today's behaviour: all automation runs
--   mode = 'manual'           — counselor line: every automation is skipped
--
-- The inbound is still stored, shown in Live Chat, and logged to the CRM — only
-- the automated *responses* are suppressed. Column is tenant-neutral; rows stay
-- tenant-scoped as before. Additive + idempotent.

alter table wa_channels add column if not exists mode text not null default 'full';

comment on column wa_channels.mode is
  'full = all automation runs (default); manual = counselor line, no AI/flow/welcome/sequence/follow-up.';
