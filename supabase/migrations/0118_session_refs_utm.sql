-- Where a lead actually came from — per visitor, not per link (0118).
--
-- wa_handle_sources maps a code to a SOURCE: a campaign link, shared by
-- everyone who clicks it. That answers "which ad produced this chat?" and
-- nothing more. It cannot answer "was this person paid or organic, Google or
-- Facebook, which campaign and which creative?", because every visitor who
-- clicks the same link shares the same code.
--
-- This maps a code to ONE VISITOR'S SESSION, and the row carries the payload.
--
-- ── Why the code rather than the values ────────────────────────────────────
--
-- The invisible ref encoder in handlehub.ts carries base36 only, and tops out
-- at 16 characters. A utm_campaign is arbitrary text of arbitrary length. So
-- the link carries a short opaque code and the row holds everything, exactly
-- as the GCLID problem was solved upstream.
--
-- A session code is 12 characters and a source code is always 7, so one can
-- never be mistaken for the other — which is what makes resolving
-- session-first safe rather than merely unlikely to collide.
--
-- ── Why UTMs are here from the start ───────────────────────────────────────
--
-- Upstream this arrived in two steps: click ids first, UTMs eight weeks later
-- once it became clear that "do we have a gclid?" only ever describes Google
-- paid traffic. Everything else — a Facebook post, an organic search, a
-- newsletter, a partner link — carries UTM parameters and no click id, and
-- was being dropped at the door. No reason to repeat that here.

create table if not exists wa_session_refs (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null default '00000000-0000-0000-0000-000000000001' references tenants(id) on delete cascade,
  ref_code        text not null,
  -- Click identifiers: proof of paid traffic, and what an ad platform needs
  -- back to credit a conversion to the click that produced it.
  gclid           text,
  fbclid          text,
  sclx_id         text,
  -- What the marketer put in the URL, verbatim. Text and nullable because a
  -- UTM is whatever somebody typed, and a value we cannot parse is still
  -- worth keeping. Bounded in the application so a hostile URL costs a
  -- truncated string rather than a rejected insert and a lost visitor.
  utm_source      text,
  utm_medium      text,
  utm_campaign    text,
  utm_term        text,
  utm_content     text,
  -- The campaign link they arrived through, when there was one.
  source_ref_code text,
  page_path       text,
  first_seen_at   timestamptz not null default now(),
  -- Set when an inbound message resolves this code: the soft metric for how
  -- many minted sessions actually produced a conversation.
  matched_at      timestamptz,
  matched_wa_id   text,
  created_at      timestamptz not null default now()
);

-- Resolution is by code alone: /chat mints it before any tenant context
-- exists, and the inbound webhook has only the code from the message body.
-- Globally unique, therefore, not unique per tenant — and the row's own
-- tenant_id is what says who it belongs to.
create unique index if not exists wa_session_refs_ref_idx on wa_session_refs (ref_code);
create index if not exists wa_session_refs_tenant_idx on wa_session_refs (tenant_id, created_at desc);
-- Reporting reads "how did last month's leads arrive?" — a scan over source
-- and medium inside one tenant.
create index if not exists wa_session_refs_utm_idx
  on wa_session_refs (tenant_id, utm_source, utm_medium)
  where utm_source is not null;

alter table wa_session_refs enable row level security;
