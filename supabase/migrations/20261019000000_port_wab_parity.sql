-- 20261019000000_port_wab_parity.sql — the schema half of the wa-broadcaster
-- parity port (tracked links, CRM push health, live-chat hand-over, ...).
--
-- Every statement is idempotent. Paste the whole file into the Supabase SQL
-- editor; running it twice changes nothing. The app degrades safely until it
-- is applied (each affected query falls back or reports which migration is
-- missing), so deploy order does not matter.

-- ── Tracked links: a per-source starter message ─────────────────────────────
-- (wab 0067) Optional prefilled text for ONE source. Falls back to the entry
-- point's greeting when null or empty. Used verbatim as the Google Ads
-- Message-asset starter message, with the invisible ref code appended.
alter table wa_handle_sources add column if not exists message text;

-- ── CRM session batching: why a row is held, and a terminal state ───────────
-- (wab 0074) The reason lives ON the row. It used to live only in the per-tick
-- health record, which any successful flush overwrote — so the explanation for
-- a permanently stuck row vanished the moment an unrelated lead pushed fine.
alter table wa_crm_session add column if not exists last_error text;
alter table wa_crm_session add column if not exists last_attempt_at timestamptz;
create index if not exists idx_crm_session_held
  on wa_crm_session (attempts, created_at) where attempts > 0;


-- (wab 0104) A status the flusher can filter on. 'pending' = still to be pushed to the CRM; 'discarded' = the lead
-- was deleted there, so pushing is pointless and retrying forever is harmful.
alter table wa_crm_session
  add column if not exists status text not null default 'pending';
update wa_crm_session set status = 'pending' where status is null;
alter table wa_crm_session drop constraint if exists wa_crm_session_status_check;
alter table wa_crm_session
  add constraint wa_crm_session_status_check check (status in ('pending', 'discarded'));
create index if not exists wa_crm_session_pending_due_idx
  on wa_crm_session (last_message_at)
  where status = 'pending';

-- ── Team scoping: which NUMBERS a person may work ───────────────────────────
-- (wab 0073 / 0075 / 0076) Strictly opt-in. Every new column is nullable and a
-- member with no team is unrestricted, so applying this changes nothing for any
-- workspace until somebody assigns a team. A team here is a tenant's own
-- internal grouping (e.g. marketing / sales / ops numbers), not a tenant.

-- A number belongs to at most one team.
alter table wa_channels add column if not exists team text;
alter table wa_channels drop constraint if exists wa_channels_team_check;
alter table wa_channels add constraint wa_channels_team_check
  check (team is null or team in ('marketing', 'sales', 'ops', 'api'));
create index if not exists idx_wa_channels_team on wa_channels (tenant_id, team);

-- A member is pinned to at most one team, and may be tied to the one number
-- they personally work (their own line).
alter table wa_users add column if not exists team text;
alter table wa_users drop constraint if exists wa_users_team_check;
alter table wa_users add constraint wa_users_team_check
  check (team is null or team in ('marketing', 'sales', 'ops', 'api'));
alter table wa_users add column if not exists channel_id uuid
  references wa_channels(id) on delete set null;
create index if not exists idx_wa_users_channel on wa_users (channel_id)
  where channel_id is not null;
comment on column wa_users.channel_id is
  'The number this member personally works (their own line), or null for shared lines and staff without one. A number may be listed against more than one member; the portal warns rather than blocking, because a genuine handover period needs both people on it.';

-- Three rungs, and the difference is scope, not seniority:
--   admin  — every number, every setting
--   lead   — runs one team: that team's numbers plus the Team progress view
--   member — works that team's numbers
-- A lead with no team would come back unrestricted — the one combination that
-- must not exist — so the database makes it unrepresentable.
alter table wa_users drop constraint if exists wa_users_role_check;
alter table wa_users add constraint wa_users_role_check
  check (role in ('admin', 'lead', 'member'));
alter table wa_users drop constraint if exists wa_users_lead_needs_team;
alter table wa_users add constraint wa_users_lead_needs_team
  check (role <> 'lead' or team is not null);
comment on column wa_users.role is
  'admin = every number, every setting; lead = runs one team (that team''s numbers + Team progress); member = works that team''s numbers.';

-- The inbox is read by number, newest activity first.
create index if not exists idx_conv_channel_last_inbound
  on wa_conversations (channel_id, last_inbound_at desc nulls last);
