-- ── When a conversation was escalated ────────────────────────────────────────
-- status='escalated' recorded THAT a chat needs a human but never WHEN, so
-- nothing could tell a handoff raised an hour ago from one forgotten for
-- months. The escalation clean-up sweep (lib/escalations.ts) needs that
-- distinction: it only resets chats escalated long enough to be considered
-- abandoned, and must never clear one an agent is still working.
--
-- Backfill uses the last customer message (else the row's creation) as the best
-- available approximation for chats already escalated — otherwise every
-- existing one would look brand new and sit untouched for a full window.
--
-- Additive + idempotent.

alter table wa_conversations add column if not exists escalated_at timestamptz;

comment on column wa_conversations.escalated_at is
  'When status last became escalated; null when not escalated. Drives the per-tenant stale-escalation sweep.';

-- Only touches rows that are escalated AND unstamped, so re-running is a no-op.
update wa_conversations
   set escalated_at = coalesce(last_inbound_at, created_at)
 where status = 'escalated'
   and escalated_at is null;

-- The sweep queries per tenant, on status + escalated_at.
create index if not exists wa_conv_escalated_at_idx
  on wa_conversations (tenant_id, escalated_at)
  where status = 'escalated';
