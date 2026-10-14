-- 0119_rate_limits.sql — a general request limiter.
--
-- ── What is unprotected, in THIS product ───────────────────────────────────
--
-- Audited 14 Oct. Three surfaces, each costing real money per request:
--
--   /api/contact   PUBLIC, and it SENDS AN EMAIL per request to the support
--                  inbox. A honeypot field catches naive bots; one that
--                  simply omits it can bury every real enquiry and burn the
--                  email quota doing it.
--
--   /api/waitlist  PUBLIC. Same honeypot, and unbounded rows behind it.
--
--   /api/events, /api/broadcast, /api/contacts
--                  key-gated, so not anonymous — but a LEAKED key could
--                  broadcast WhatsApp messages continuously until somebody
--                  noticed the bill and the sender reputation.
--
-- Signup is already throttled (loginThrottle) and /api/llm/respond is behind
-- CRON_SECRET, so neither needed this.
--
-- ── Why a function and not a read-then-write ────────────────────────────────
--
-- Counting with SELECT-then-UPDATE is a race, and this codebase has already
-- paid for that once: a bare SELECT claim on the send queue re-sent 1,739
-- duplicate templates. Under a flood — the exact condition a limiter exists
-- for — concurrent requests all read the same count and all decide they are
-- under the limit.
--
-- So the increment, the window roll and the verdict are ONE statement. The
-- upsert either starts a new window or adds to the live one, and returns the
-- resulting count. Nothing can interleave.
--
-- ── Why this table has no RLS ───────────────────────────────────────────────
--
-- Deliberate, and the same reasoning as wa_login_attempts: it is platform
-- infrastructure, not tenant data. If it were tenant-scoped, a confined client
-- would read zero hits and the limiter would silently stop limiting — a
-- security control that fails by doing nothing is worse than none, because it
-- looks present.

create table if not exists wa_rate_limits (
  -- "widget:msg:<site key>:<ip>", "api:<key prefix>:<scope>", …
  -- The caller composes it; the shape is the application's business.
  bucket       text primary key,
  count        int not null default 0,
  window_start timestamptz not null default now()
);

comment on table wa_rate_limits is
  'Fixed-window request counters. Platform-level: NO row level security, by design — see 0119.';

create index if not exists wa_rate_limits_window_idx on wa_rate_limits (window_start);

-- Returns whether this hit is allowed, and how long until the window rolls.
--
-- The count is incremented BEFORE the verdict, including on a rejected
-- request. That is the intent: a caller hammering a limit keeps their own
-- window full rather than being handed one free request per window as soon as
-- they stop.
create or replace function rate_limit_hit(p_bucket text, p_limit int, p_window_sec int)
returns table (allowed boolean, retry_after int)
language plpgsql
as $$
declare
  v_count int;
  v_start timestamptz;
  v_cutoff timestamptz := now() - make_interval(secs => p_window_sec);
begin
  insert into wa_rate_limits as r (bucket, count, window_start)
  values (p_bucket, 1, now())
  on conflict (bucket) do update
    set count = case when r.window_start < v_cutoff then 1 else r.count + 1 end,
        window_start = case when r.window_start < v_cutoff then now() else r.window_start end
  returning r.count, r.window_start into v_count, v_start;

  -- Housekeeping, occasionally. One row per distinct caller would otherwise
  -- grow without bound; doing it on roughly one call in a thousand keeps the
  -- cost off the hot path without needing a scheduled job that can be
  -- forgotten or fail silently.
  if random() < 0.001 then
    delete from wa_rate_limits where window_start < now() - interval '1 day';
  end if;

  return query select
    v_count <= p_limit,
    greatest(0, p_window_sec - floor(extract(epoch from (now() - v_start)))::int);
end $$;

revoke all on function rate_limit_hit(text, int, int) from public;
grant execute on function rate_limit_hit(text, int, int) to service_role;
