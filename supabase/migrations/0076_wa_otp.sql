-- ── WhatsApp OTP service (multi-tenant) ──────────────────────────────────────
-- Ported from the internal portal. Each tenant delivers login codes over its own
-- WhatsApp number(s): /api/otp/send generates a code, stores only its HASH here,
-- and sends a Meta AUTHENTICATION template; /api/otp/verify checks a submission.
-- Consuming websites authenticate with a per-tenant API key (Authorization:
-- Bearer ak_live_…); the tenant is resolved from the key, so codes are isolated
-- per tenant. The hash is peppered with a single global env secret
-- (OTP_HASH_SECRET) — a pepper only, never used for auth.
--
-- One row per (tenant, phone) — the latest code wins. The row also carries the
-- per-phone abuse counters: resend cooldown (last_sent_at), a daily send cap
-- (sends_today/sends_day), and a verify-attempt cap (attempts). A consumed or
-- replaced code overwrites the row — counters survive, plaintext never exists.
--
-- Additive + idempotent.

create table if not exists wa_otp_codes (
  tenant_id    uuid not null default '00000000-0000-0000-0000-000000000001' references tenants(id) on delete cascade,
  phone        text not null,                         -- digits only
  code_hash    text not null,                         -- sha256(tenant:phone:code:secret); "" once consumed
  expires_at   timestamptz not null,
  attempts     int not null default 0,                -- wrong guesses against the active code
  last_sent_at timestamptz not null default now(),    -- resend cooldown anchor
  sends_today  int not null default 1,                -- sends within sends_day
  sends_day    date not null default current_date,
  created_at   timestamptz not null default now(),
  primary key (tenant_id, phone)
);

comment on table wa_otp_codes is
  'Active WhatsApp OTP per (tenant, phone) (hash only) + per-phone rate/attempt counters. Codes are sent as Meta AUTHENTICATION templates.';

-- Deny-by-default for the public anon/authenticated PostgREST roles (the app
-- uses the service role, which bypasses RLS) — same backstop as 0037. Without
-- this, the public anon key could read/write every tenant's OTP rows (phone
-- PII, counters) via direct REST.
alter table wa_otp_codes enable row level security;

-- The caps MUST be enforced atomically: a read-modify-write in app code lets
-- concurrent requests all pass the same stale gate (brute-forcing the code or
-- flooding the number). These functions do the check + counter mutation under a
-- row lock (SELECT ... FOR UPDATE), so N concurrent calls serialize correctly.
-- Both are scoped by p_tenant so one tenant's traffic never touches another's.
-- Idempotent (create or replace).

-- Reserve one send: enforce cooldown + per-day cap atomically, then stamp the
-- new hash. Returns allowed + (on cooldown) seconds to wait. The caller sends
-- the WhatsApp template only when allowed=true. sends_day is the UTC date, to
-- match the app's day boundary.
create or replace function otp_reserve_send(
  p_tenant uuid, p_phone text, p_hash text, p_expires timestamptz,
  p_cooldown_s int, p_daily_cap int, p_now timestamptz
) returns table(allowed boolean, retry_after int, reason text)
language plpgsql as $$
declare
  r wa_otp_codes%rowtype;
  sent_today int;
  since numeric;
begin
  select * into r from wa_otp_codes where tenant_id = p_tenant and phone = p_phone for update;

  if not found then
    insert into wa_otp_codes(tenant_id, phone, code_hash, expires_at, attempts, last_sent_at, sends_today, sends_day)
    values (p_tenant, p_phone, p_hash, p_expires, 0, p_now, 1, (p_now at time zone 'UTC')::date);
    allowed := true; retry_after := 0; reason := 'ok'; return next; return;
  end if;

  since := extract(epoch from (p_now - r.last_sent_at));
  if since < p_cooldown_s then
    allowed := false; retry_after := ceil(p_cooldown_s - since)::int; reason := 'cooldown'; return next; return;
  end if;

  sent_today := case when r.sends_day = (p_now at time zone 'UTC')::date then r.sends_today else 0 end;
  if sent_today >= p_daily_cap then
    allowed := false; retry_after := 0; reason := 'daily_cap'; return next; return;
  end if;

  update wa_otp_codes set
    code_hash = p_hash, expires_at = p_expires, attempts = 0,
    last_sent_at = p_now, sends_today = sent_today + 1, sends_day = (p_now at time zone 'UTC')::date
  where tenant_id = p_tenant and phone = p_phone;
  allowed := true; retry_after := 0; reason := 'ok'; return next; return;
end;
$$;

-- Claim one verify attempt: atomically reject if no active code / expired / cap
-- reached, else increment attempts and hand back the stored hash so the caller
-- compares it constant-time. Claiming the slot BEFORE the compare bounds the
-- number of guesses actually tested to p_max, even under concurrency.
create or replace function otp_claim_attempt(
  p_tenant uuid, p_phone text, p_max int, p_now timestamptz
) returns table(ok boolean, out_hash text, reason text)
language plpgsql as $$
declare
  r wa_otp_codes%rowtype;
begin
  select * into r from wa_otp_codes where tenant_id = p_tenant and phone = p_phone for update;
  if not found or r.code_hash = '' then
    ok := false; out_hash := ''; reason := 'no_active_code'; return next; return;
  end if;
  if r.expires_at < p_now then
    ok := false; out_hash := ''; reason := 'expired'; return next; return;
  end if;
  if r.attempts >= p_max then
    ok := false; out_hash := ''; reason := 'too_many_attempts'; return next; return;
  end if;
  update wa_otp_codes set attempts = r.attempts + 1 where tenant_id = p_tenant and phone = p_phone;
  ok := true; out_hash := r.code_hash; reason := 'claimed'; return next; return;
end;
$$;
