-- ── Lead ownership: who is responsible for a conversation, and how it changed ──
-- wa_conversations.channel_id used to mean two different things at once: the
-- number that OWNS the lead, and the number that most recently touched it. For
-- WhatsApp, getOrCreateConversation overwrote it on every inbound message and
-- every coexistence echo ("follow the customer"), while the Live Chat reply box
-- sends through credsFor(conv.channel_id).
--
-- That reasoning held while a tenant's numbers were interchangeable brand lines.
-- It breaks the moment a tenant runs WhatsApp coexistence with one number per
-- counselor: the numbers are personal identities, so a manual reply would leave
-- through whichever counselor the customer had messaged LAST, not the counselor
-- actually typing it. (IG/Messenger/web-chat were already anchored — see 0073's
-- era comment — because those accounts carry their own persona/KB.)
--
-- channel_id is now STICKY for every platform: first touch wins, and only a
-- deliberate reassign moves it. A customer may still message any number — each
-- message keeps recording its own true channel on wa_conv_messages.channel_id
-- (0073) — but ownership no longer drifts. This table records the trail.
--
-- Additive + idempotent.

create table if not exists wa_conversation_owner_history (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null default '00000000-0000-0000-0000-000000000001' references tenants(id) on delete cascade,
  conversation_id uuid not null references wa_conversations(id) on delete cascade,
  channel_id      uuid references wa_channels(id) on delete set null,
  changed_by      text not null default 'system',
  reason          text,
  created_at      timestamptz not null default now()
);

-- The detail panel reads one conversation's trail oldest-first.
create index if not exists wa_conv_owner_history_conv_idx
  on wa_conversation_owner_history (conversation_id, created_at);

comment on table wa_conversation_owner_history is
  'Ownership trail for a conversation: which channel (number/account) owned the lead, when it changed, and who changed it. First row = first touch, written at conversation creation.';
comment on column wa_conversation_owner_history.channel_id is
  'The channel that became the owner at this point. Null = owner cleared / channel later deleted.';
comment on column wa_conversation_owner_history.changed_by is
  'Admin name/email that reassigned, or ''system'' for the automatic first-touch row.';

-- Deny-by-default for the public anon/authenticated PostgREST roles (the app
-- uses the service role, which bypasses RLS) — same backstop as 0037/0077.
alter table wa_conversation_owner_history enable row level security;

-- ── Backfill, so existing leads have a trail instead of a blank panel ────────
-- First touch is recovered from real data: the earliest message on the thread
-- that recorded a channel (wa_conv_messages.channel_id, added in 0073). Threads
-- older than that column, or with no channel on any message, are skipped rather
-- than guessed at. Both inserts skip conversations that already have a trail, so
-- re-running this migration is a no-op rather than a source of duplicates.
insert into wa_conversation_owner_history (tenant_id, conversation_id, channel_id, changed_by, reason, created_at)
select distinct on (m.conversation_id)
       m.tenant_id, m.conversation_id, m.channel_id, 'system', 'First contact (backfilled)', m.created_at
from wa_conv_messages m
where m.channel_id is not null
  and not exists (
    select 1 from wa_conversation_owner_history h where h.conversation_id = m.conversation_id
  )
order by m.conversation_id, m.created_at asc;

-- Because channel_id was previously overwritten by whichever number touched a
-- WhatsApp thread last, a conversation's CURRENT owner is often not its first
-- touch. Add that second step explicitly (stamped now, when ownership became
-- sticky) so the trail reads honestly instead of implying the lead never moved.
insert into wa_conversation_owner_history (tenant_id, conversation_id, channel_id, changed_by, reason)
select c.tenant_id, c.id, c.channel_id, 'system', 'Owner when ownership was frozen'
from wa_conversations c
join wa_conversation_owner_history h
  on h.conversation_id = c.id and h.reason = 'First contact (backfilled)'
where c.channel_id is not null
  and c.channel_id <> h.channel_id
  and not exists (
    select 1 from wa_conversation_owner_history h2
    where h2.conversation_id = c.id and h2.reason = 'Owner when ownership was frozen'
  );
