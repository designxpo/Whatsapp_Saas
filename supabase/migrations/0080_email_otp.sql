-- ── Email OTP + trusted devices (platform login/signup) ─────────────────────
-- Two independent concerns, both platform-auth (not tenant-scoped data):
--   1. email_otps — a one-time code emailed for (a) verifying an email BEFORE
--      a signup account is created, and (b) a 2FA challenge on login from a
--      device that hasn't been seen before. One row per (email, purpose); the
--      latest code wins. Same hash-only + atomic-rate-limit pattern as the
--      WhatsApp OTP feature (0076_wa_otp.sql), keyed by email instead of
--      (tenant, phone) since login/signup precede tenant resolution.
--   2. trusted_devices — a device is "trusted" (skips the login OTP) once it
--      has completed an OTP challenge. Keyed by email + an opaque random
--      token stored in a long-lived cookie — NOT by tenant_id, since the
--      platform owner account has no tenant-scoped user row.
--
-- Additive + idempotent.

create table if not exists email_otps (
  email        text not null,
  purpose      text not null check (purpose in ('login', 'signup')),
  code_hash    text not null,                         -- sha256(email:purpose:code:secret); "" once consumed
  expires_at   timestamptz not null,
  attempts     int not null default 0,                -- wrong guesses against the active code
  last_sent_at timestamptz not null default now(),     -- resend cooldown anchor
  sends_today  int not null default 1,                -- sends within sends_day
  sends_day    date not null default current_date,
  created_at   timestamptz not null default now(),
  primary key (email, purpose)
);

comment on table email_otps is
  'Active email OTP per (email, purpose) (hash only) + per-email rate/attempt counters. Sent via Resend.';

-- Deny-by-default for the public anon/authenticated PostgREST roles (the app
-- uses the service role, which bypasses RLS) — same backstop as 0076/0037.
alter table email_otps enable row level security;

create table if not exists trusted_devices (
  id           uuid primary key default gen_random_uuid(),
  email        text not null,
  device_token text not null,                         -- opaque random token, stored in an httpOnly cookie
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create unique index if not exists trusted_devices_email_token_idx on trusted_devices(email, device_token);
create index if not exists trusted_devices_email_idx on trusted_devices(email);

comment on table trusted_devices is
  'Devices that have completed an email-OTP challenge for this email, so login skips the 2FA step until this record is gone.';

alter table trusted_devices enable row level security;

-- The caps MUST be enforced atomically: a read-modify-write in app code lets
-- concurrent requests all pass the same stale gate (spamming the inbox or
-- brute-forcing the code). These functions do the check + counter mutation
-- under a row lock (SELECT ... FOR UPDATE), mirroring otp_reserve_send /
-- otp_claim_attempt in 0076_wa_otp.sql exactly, just keyed by (email, purpose)
-- instead of (tenant_id, phone). Idempotent (create or replace).

create or replace function email_otp_reserve_send(
  p_email text, p_purpose text, p_hash text, p_expires timestamptz,
  p_cooldown_s int, p_daily_cap int, p_now timestamptz
) returns table(allowed boolean, retry_after int, reason text)
language plpgsql as $$
declare
  r email_otps%rowtype;
  sent_today int;
  since numeric;
begin
  select * into r from email_otps where email = p_email and purpose = p_purpose for update;

  if not found then
    insert into email_otps(email, purpose, code_hash, expires_at, attempts, last_sent_at, sends_today, sends_day)
    values (p_email, p_purpose, p_hash, p_expires, 0, p_now, 1, (p_now at time zone 'UTC')::date);
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

  update email_otps set
    code_hash = p_hash, expires_at = p_expires, attempts = 0,
    last_sent_at = p_now, sends_today = sent_today + 1, sends_day = (p_now at time zone 'UTC')::date
  where email = p_email and purpose = p_purpose;
  allowed := true; retry_after := 0; reason := 'ok'; return next; return;
end;
$$;

-- Claim one verify attempt: atomically reject if no active code / expired /
-- attempt cap reached, else increment attempts and hand back the stored hash
-- so the caller compares it constant-time. Claiming the slot BEFORE the
-- compare bounds the number of guesses actually tested to p_max, even under
-- concurrency.
create or replace function email_otp_claim_attempt(
  p_email text, p_purpose text, p_max int, p_now timestamptz
) returns table(ok boolean, out_hash text, reason text)
language plpgsql as $$
declare
  r email_otps%rowtype;
begin
  select * into r from email_otps where email = p_email and purpose = p_purpose for update;
  if not found or r.code_hash = '' then
    ok := false; out_hash := ''; reason := 'no_active_code'; return next; return;
  end if;
  if r.expires_at < p_now then
    ok := false; out_hash := ''; reason := 'expired'; return next; return;
  end if;
  if r.attempts >= p_max then
    ok := false; out_hash := ''; reason := 'too_many_attempts'; return next; return;
  end if;
  update email_otps set attempts = r.attempts + 1 where email = p_email and purpose = p_purpose;
  ok := true; out_hash := r.code_hash; reason := 'claimed'; return next; return;
end;
$$;

-- Blank the code on success (single-use) — called by app code after a match.
create or replace function email_otp_consume(p_email text, p_purpose text) returns void
language sql as $$
  update email_otps set code_hash = '' where email = p_email and purpose = p_purpose;
$$;
