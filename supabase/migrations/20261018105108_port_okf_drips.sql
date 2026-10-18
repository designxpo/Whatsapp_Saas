-- 0105_kb_concepts.sql — the OKF library: one row per concept, with a status
-- that decides whether the assistant may use it.
--
-- ── Why this exists next to kb_documents/kb_chunks ──────────────────────────
--
-- Ten documents were uploaded by different people over several months and nine
-- of them restate the same knowledge: fees appear in 9 of 10, eligibility in 9,
-- the centres in 8. Exact-text duplication is 0%, so none of it is visible to a
-- hash or to anyone reading the document list.
--
-- A chunk cannot fix that, because a chunk has no identity — it is the 412th
-- 1,000-character window of a file, and there is no way to say "this is the
-- fee, and that other passage is the same fact stated again". A concept has a
-- PATH, so the second statement of the fee is recognisably the same subject as
-- the first, and the two can be merged or held apart deliberately.
--
-- kb_documents stays as the record of what was uploaded (provenance, re-sync,
-- the audit trail). kb_chunks stays as the vector index. This table sits
-- between them: the thing people edit and the thing embeddings are built FROM.
--
-- ── status is the safety property ───────────────────────────────────────────
--
--   active      the assistant may answer from it. At most one per path.
--   pending     awaiting review. NEVER embedded, never retrievable.
--   superseded  replaced; kept for provenance and audit. Never embedded.
--
-- Today a file dropped into the portal is retrievable minutes later with no
-- review, so a careless upload silently changes what the bot tells a lead.
-- With this, a contradicting upload lands `pending` while the live answer stays
-- `active`, and only `active` rows are ever embedded — so retrieval is never
-- choosing between two versions of the truth.

create table if not exists kb_concepts (
  id           uuid primary key default gen_random_uuid(),

  -- OKF identity. The path IS the concept, so it is unique among live rows —
  -- enforced by the partial index below rather than a plain unique constraint,
  -- because a superseded row keeps its path for the audit trail and several
  -- pending candidates may legitimately be queued against one live concept.
  path         text not null,
  area         text not null,
  type         text not null,

  -- OKF front matter.
  title        text,
  description  text,
  resource     text,
  tags         text[] not null default '{}',
  body         text not null default '',
  -- Fields the spec does not reserve. "The producer decides what other fields
  -- each document carries", so these are kept rather than dropped.
  extra        jsonb not null default '{}'::jsonb,

  status       text not null default 'pending'
                 check (status in ('active', 'pending', 'superseded')),
  -- Why a row is pending, in words a reviewer can act on.
  review_note  text,

  -- Every upload that has contributed to this concept. An array, not a single
  -- column, because a merged concept genuinely comes from several and losing
  -- that makes a disputed fact untraceable.
  sources      text[] not null default '{}',
  document_id  uuid references kb_documents(id) on delete set null,

  -- How confidently the classifier placed it. Low values are review fodder.
  confidence   real,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  tenant_id    uuid not null references tenants(id) on delete cascade
);

-- One live concept per path per tenant. Partial, so superseded history and
-- queued pending candidates do not collide with it.
create unique index if not exists kb_concepts_active_path_idx
  on kb_concepts (tenant_id, path)
  where status = 'active';

-- The publish path reads active rows by area; the review queue reads pending
-- oldest-first. Both are hot enough to deserve their own index.
create index if not exists kb_concepts_area_status_idx on kb_concepts (tenant_id, area, status);
create index if not exists kb_concepts_pending_idx on kb_concepts (tenant_id, created_at)
  where status = 'pending';

-- Channel scoping (wa_channels.kb_tag) filters on tags.
create index if not exists kb_concepts_tags_idx on kb_concepts using gin (tags);

-- Which document a concept came from, for re-ingest and for deletion cascade.
create index if not exists kb_concepts_document_idx on kb_concepts (document_id);

-- Link a chunk back to the concept it was built from, so a re-embed can
-- replace exactly one concept's vectors instead of a whole document's. Today
-- editing one line re-chunks and re-embeds all 1,171 chunks of its file.
alter table kb_chunks add column if not exists concept_id uuid
  references kb_concepts(id) on delete cascade;
create index if not exists kb_chunks_concept_idx on kb_chunks (concept_id);

alter table kb_concepts enable row level security;
revoke all on kb_concepts from anon, authenticated;
grant all on kb_concepts to service_role;

-- 0106_kb_concept_search.sql — retrieval over the OKF library.
--
-- Concept vectors and document vectors share kb_chunks, told apart by
-- concept_id (0105). They have to be searched separately: with both visible at
-- once the assistant would see the old passage AND the concept built from it,
-- which is the duplicate-answer problem this whole exercise exists to remove,
-- reintroduced one layer down.
--
-- These are NEW functions rather than changes to match_kb_chunks and friends.
-- The old ones keep working untouched, so switching the library on is an env
-- flag and switching it back is the same flag — no migration, no re-embed, no
-- window where retrieval is broken either way.
--
-- ── Only active concepts are answerable ─────────────────────────────────────
--
-- The join to kb_concepts is filtered on status = 'active', so a pending or
-- superseded concept cannot be retrieved even if its vectors are still in the
-- table. The publish step already avoids embedding them; this makes it
-- structural rather than a promise the application has to keep. A quarantined
-- upload must never reach a lead, and that guarantee should not depend on
-- every future caller remembering it.
--
-- ── Tags, not document tags ─────────────────────────────────────────────────
--
-- Channel scoping (wa_channels.kb_tag) used to filter kb_documents.tag, one
-- value per upload. A concept carries an ARRAY, because a merged concept
-- genuinely belongs to every source that contributed — the brochure's fee and
-- the website's fee become one concept tagged with both, and a number scoped
-- to either must still reach it. A null tag means "no scope", not "no match".

create or replace function match_kb_concept_chunks(
  query_embedding vector(768),
  match_count int,
  p_tenant_id uuid,
  concept_tag text default null
)
returns table (content text, document_id uuid, concept_id uuid, similarity float)
language sql stable security invoker set search_path = public as $$
  select c.content, c.document_id, c.concept_id,
         1 - (c.embedding <=> query_embedding) as similarity
  from kb_chunks c
  join kb_concepts k on k.id = c.concept_id
  where k.status = 'active' and k.tenant_id = p_tenant_id and c.tenant_id = p_tenant_id
    and (concept_tag is null or k.tags @> array[concept_tag])
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

create or replace function match_kb_concept_chunks_text(
  query_text text,
  match_count int,
  p_tenant_id uuid,
  concept_tag text default null
)
returns table (content text, document_id uuid, concept_id uuid, rank float)
language sql stable security invoker set search_path = public as $$
  select c.content, c.document_id, c.concept_id,
         ts_rank(c.content_tsv, websearch_to_tsquery('english', query_text)) as rank
  from kb_chunks c
  join kb_concepts k on k.id = c.concept_id
  where k.status = 'active' and k.tenant_id = p_tenant_id and c.tenant_id = p_tenant_id
    and (concept_tag is null or k.tags @> array[concept_tag])
    and c.content_tsv @@ websearch_to_tsquery('english', query_text)
  order by rank desc
  limit match_count;
$$;

revoke all on function match_kb_concept_chunks(vector, int, uuid, text) from public, anon, authenticated;
revoke all on function match_kb_concept_chunks_text(text, int, uuid, text) from public, anon, authenticated;
grant execute on function match_kb_concept_chunks(vector, int, uuid, text) to service_role;
grant execute on function match_kb_concept_chunks_text(text, int, uuid, text) to service_role;

-- 0100_sequence_lanes.sql — file every drip journey under a team and an AIDA stage.
--
-- Marketing and Sales both run a full Attention → Interest → Desire → Action
-- funnel, on different audiences, in different voices. Until now a sequence
-- belonged to nobody: there was no way to say which team owns a journey, so
-- there was no way to show a counsellor only theirs, no way to pick the right
-- sending number, and no way to see that the Sales lane has no Desire journey
-- at all — which is exactly what the audit found.
--
-- `team` reuses the vocabulary 0073 already established on wa_channels and
-- wa_users rather than inventing a second one. The constraint accepts all four
-- values so the column means the same thing everywhere it appears, even though
-- the picker offers only marketing and sales: an api number has no human inbox
-- to run a funnel from, and ops journeys are a later question.
--
-- `aida_stage` is documentation the code reads back to the operator, not a
-- branch. Nothing in the engine behaves differently because a journey is
-- labelled `desire`. Its job is to make a missing rung visible on the list
-- screen, which is the one thing nobody could see before.
--
-- BOTH NULLABLE, deliberately. There is one sequence in production and it is a
-- test with neither. NOT NULL would force this migration to guess which lane a
-- sequence called "Cart Abandoned" that fires on the keyword "test" belongs to,
-- and a guess written into a constraint is indistinguishable afterwards from a
-- decision somebody made. Unfiled sequences read as "Unassigned" and behave
-- exactly as they do today — no lane check is applied to them.
--
-- Additive + idempotent.

alter table wa_sequences add column if not exists team text;
alter table wa_sequences drop constraint if exists wa_sequences_team_check;
alter table wa_sequences add constraint wa_sequences_team_check
  check (team is null or team in ('marketing', 'sales', 'ops', 'api'));

alter table wa_sequences add column if not exists aida_stage text;
alter table wa_sequences drop constraint if exists wa_sequences_aida_stage_check;
alter table wa_sequences add constraint wa_sequences_aida_stage_check
  check (aida_stage is null or aida_stage in ('attention', 'interest', 'desire', 'action', 'retention'));

comment on column wa_sequences.team is
  'Which lane owns this journey (0073 vocabulary). Null = unfiled: no lane check is applied and it behaves as it did before 0100.';
comment on column wa_sequences.aida_stage is
  'Which job in the funnel this journey does. Read back to the operator so a missing rung is visible; the engine never branches on it.';

-- The list screen groups by team, and the lane guard reads a sequence's team on
-- every enrolment.
create index if not exists wa_sequences_team_idx on wa_sequences (team) where team is not null;

-- 0101_sequence_reply_stop_and_window.sql — two rules the RNR follow-up needs,
-- and that every drip should have had.
--
-- ── stop_on_reply ───────────────────────────────────────────────────────────
--
-- Today only an `inactivity` sequence stops when the lead answers. Every other
-- kind "runs to completion as designed", which was a reasonable default when
-- the only drips were short and transactional. It is the wrong default for a
-- nurture: a lead taps "Yes, call me now" on day 2, a counsellor rings them,
-- and the drip carries on delivering "Not sure yet? See how we teach first" on
-- day 5 to somebody already in a conversation. That is the single worst thing
-- this engine can do, and it is currently the default for six of the seven
-- messages in the RNR brief.
--
-- DEFAULT TRUE, deliberately. Stopping when somebody replies is what an
-- operator assumes is already happening — nobody has ever asked for a drip
-- that talks over a live conversation. There is one sequence in production and
-- it is a keyword test, so the blast radius of changing the default is that
-- test. A sequence that genuinely must run to completion (an order-status
-- series, where the customer replying is irrelevant to whether the parcel
-- shipped) sets this to false and says so in the UI.
--
-- ── send_start_hour / send_end_hour ─────────────────────────────────────────
--
-- Steps fire purely on elapsed delay. A lead marked Not Reachable at 23:10
-- gets "greetings from AnalytixLabs" at 23:10 the following night. The brief
-- says 10 AM to 8 PM; sales say callbacks only happen 11 AM to 5 PM. Rather
-- than pick one, the window lives on the sequence so the argument is a setting
-- rather than a deploy.
--
-- NULL = no restriction, which is exactly today's behaviour, so nothing that
-- exists starts behaving differently. Hours are 0–23 in the deployment's local
-- reckoning; a half-open range [start, end) so 10–20 means the last send can
-- begin at 19:59 and never at 20:00.
--
-- A window is DEFERRED, never skipped. The step's turn comes at the next
-- opening rather than being dropped, because a message nobody sent is a lead
-- nobody contacted, and the existing "skip and advance" behaviour for closed
-- 24h windows already taught us how quiet that failure is.
--
-- Additive + idempotent.

alter table wa_sequences add column if not exists stop_on_reply boolean not null default true;

alter table wa_sequences add column if not exists send_start_hour smallint;
alter table wa_sequences add column if not exists send_end_hour smallint;

alter table wa_sequences drop constraint if exists wa_sequences_send_window_check;
alter table wa_sequences add constraint wa_sequences_send_window_check check (
  (send_start_hour is null and send_end_hour is null)
  or (
    send_start_hour between 0 and 23
    and send_end_hour between 1 and 24
    and send_start_hour < send_end_hour
  )
);

comment on column wa_sequences.stop_on_reply is
  'Stop this journey the moment the lead replies, taps a button, or a human takes the conversation. Default true; false only for series where a reply is irrelevant.';
comment on column wa_sequences.send_start_hour is
  'First hour a step may send (0-23, local). Null with send_end_hour = send at any hour, which is the pre-0101 behaviour.';
comment on column wa_sequences.send_end_hour is
  'Exclusive end hour (1-24, local). 10 and 20 means a step may start at 19:59 but never at 20:00. Steps outside the window are DEFERRED to the next opening, never dropped.';

-- 0103_sequence_audience_and_limits.sql — the four rules in the RNR brief that
-- the engine could not express, plus the flag its "wrong number" rule needs.
--
-- ── wa_sequence_steps.audience ──────────────────────────────────────────────
--
-- Three of the seven RNR messages are not for everyone:
--
--   R+5   Free masterclass   only leads not already registered
--   R+10  Results in numbers only programmes that carry those terms
--   R+15  Centre visit       only Bangalore/NCR, and never the online-only courses
--
-- Until now a step went to every enrolled lead, so the only way to express
-- this was three separate sequences — which would then each need their own
-- enrolment rule, their own stop rule and their own window, and would drift
-- apart the first time somebody edited one of them.
--
-- The rule is per STEP rather than per sequence because that is where the
-- brief puts it, and it is JSON rather than columns because the interesting
-- part is which CRM attribute to read, and that is their vocabulary, not
-- ours. seqaudience.ts is the only thing that interprets it.
--
-- NULL = everyone, so every step that exists today keeps behaving identically.
--
-- ── wa_sequences.skip_if_recent_reply_days ─────────────────────────────────
--
-- "Tapped A or B but still RNR → skip the sequence. Counsellor chats instead."
--
-- A lead who answered the counsellor's own message on day 1 or 2 is not
-- silent; they are simply not answering the PHONE. Dripping four weeks of
-- nurture at somebody already in a conversation is the exact failure
-- stop_on_reply exists to prevent — this closes the same hole one step
-- earlier, at enrolment, where the reply happened BEFORE the journey began
-- and so is invisible to a stop rule that only looks forward.
--
-- Days rather than a boolean because "has this lead ever written to us" is
-- the wrong question: an enquiry from four months ago is not a live
-- conversation. The RNR journey uses 3, which covers the two days of call
-- attempts and the day the stage changes.
--
-- NULL = off, which is every sequence that exists today.
--
-- ── wa_sequences.max_per_day ───────────────────────────────────────────────
--
-- "One message per day at most, and never the same one twice."
--
-- Steps are spaced by delay alone, so nothing stopped two of them landing in
-- the same afternoon once a deferral had shifted one — and a deferral is now
-- routine, because 0101's send window pushes every out-of-hours step to the
-- next opening, where it can meet the step that was already due there.
--
-- DEFERRED to the next day's opening, never dropped, for the same reason the
-- send window defers: an unsent nurture message is a lead nobody contacted.
--
-- NULL = no cap, which is every sequence that exists today.
--
-- ── contacts.wa_unreachable_at / _reason ───────────────────────────────────
--
-- "Number not on WhatsApp → flag as possible wrong number."
--
-- Meta answers a send to a number that has no WhatsApp account with error
-- 131026. Today that is recorded as last_error on one enrolment and nowhere
-- else, so the same dead number is retried by every future campaign and
-- nobody can list them to be re-checked by phone.
--
-- A timestamp rather than a boolean: knowing WHEN we learnt it is what makes
-- it safe to clear later — a number can gain a WhatsApp account after we
-- flagged it, and "flagged eight months ago" is a different fact from
-- "flagged this morning".
--
-- Additive + idempotent.

alter table wa_sequence_steps add column if not exists audience jsonb;

comment on column wa_sequence_steps.audience is
  'Who this step is for, as a rule object read by seqaudience.ts ({attrIn, attrNotIn, hasTag, lacksTag}). Null = everyone. A lead who does not match is SKIPPED and the journey advances; it is not stopped.';

alter table wa_sequences add column if not exists skip_if_recent_reply_days smallint;
alter table wa_sequences drop constraint if exists wa_sequences_skip_recent_reply_check;
alter table wa_sequences add constraint wa_sequences_skip_recent_reply_check
  check (skip_if_recent_reply_days is null or skip_if_recent_reply_days between 1 and 365);

comment on column wa_sequences.skip_if_recent_reply_days is
  'Refuse to enrol a lead who sent us anything in the last N days — they are mid-conversation, not silent. Null = off (every sequence before 0103).';

alter table wa_sequences add column if not exists max_per_day smallint;
alter table wa_sequences drop constraint if exists wa_sequences_max_per_day_check;
alter table wa_sequences add constraint wa_sequences_max_per_day_check
  check (max_per_day is null or max_per_day between 1 and 50);

comment on column wa_sequences.max_per_day is
  'Most automated messages this lead may receive in one local day, counted across every journey. A step over the cap is DEFERRED to the next day, never dropped. Null = no cap.';

alter table contacts add column if not exists wa_unreachable_at timestamptz;
alter table contacts add column if not exists wa_unreachable_reason text;

comment on column contacts.wa_unreachable_at is
  'When WhatsApp last told us this number has no account (Meta error 131026). Possible wrong number — worth a call. Cleared only by hand: a number can gain an account later, and we do not learn that from a send we never attempted.';
comment on column contacts.wa_unreachable_reason is
  'What Meta actually said, kept verbatim so a future code can be told apart from 131026 without guessing.';

-- Listing the flagged numbers for a re-check is the only query this column has.
create index if not exists contacts_wa_unreachable_idx
  on contacts (wa_unreachable_at) where wa_unreachable_at is not null;

alter table wa_channels add column if not exists team text;

alter table wa_handle_sources add column if not exists short_slug text;

-- Clicks are counted SEPARATELY from touches.
--
-- `touches` (0053) is incremented by the inbound webhook when a message
-- carrying this ref code actually arrives — it means "conversations started",
-- and the portal renders it as "N chats". A click on a short link is a
-- different event: somebody opened WhatsApp. Most will send the message, some
-- will not. Folding clicks into `touches` would inflate the only number that
-- currently means a real conversation, so they get their own column — and the
-- two together are the funnel (clicks → chats) rather than one muddied metric.
alter table wa_handle_sources add column if not exists short_clicks int not null default 0;
alter table wa_handle_sources add column if not exists short_last_click_at timestamptz;

create unique index if not exists wa_handle_sources_short_slug_idx
  on wa_handle_sources (short_slug) where short_slug is not null;

comment on column wa_handle_sources.short_slug is
  'Public /s/<slug> short form of this source''s tracked link. Globally unique: the slug is what resolves an anonymous request to a tenant.';
comment on column wa_handle_sources.short_clicks is
  'Short-link opens. Deliberately NOT touches, which counts conversations actually started.';

-- Backfill, so every source that already exists has a short link the moment
-- this lands rather than only the ones created afterwards.
--
-- The alphabet drops 0/O/o, 1/l/I — these end up on printed posters and read
-- aloud over the phone, and a slug nobody can transcribe is not short, it is
-- broken. 31^5 = 28.6M, and the unique index is what actually decides: a
-- collision raises, is caught, and the row tries again.
do $$
declare
  alphabet constant text := '23456789abcdefghjkmnpqrstuvwxyz';
  r         record;
  candidate text;
  placed    boolean;
begin
  for r in select id from wa_handle_sources where short_slug is null loop
    placed := false;
    for attempt in 1..25 loop
      candidate := '';
      for i in 1..5 loop
        candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
      end loop;
      begin
        update wa_handle_sources set short_slug = candidate where id = r.id;
        placed := true;
        exit;
      exception when unique_violation then
        null;   -- taken; draw again
      end;
    end loop;
    if not placed then
      raise exception 'could not allocate a unique short_slug for wa_handle_sources.% after 25 attempts', r.id;
    end if;
  end loop;
end $$;
