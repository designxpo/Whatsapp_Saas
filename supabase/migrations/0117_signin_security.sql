-- Stronger sign-in: authenticator app, passkeys, and password reset by email.
--
-- KEYED BY EMAIL, DELIBERATELY NOT BY TENANT. wa_users.email is global-unique
-- (0020_tenant_unique_constraints.sql lists it under "left intentionally
-- GLOBAL-unique") and login resolves an account by email alone, reading the
-- tenant off the row afterwards. email_otps and trusted_devices already follow
-- this shape for the same reason: the platform owner account has no
-- tenant-scoped user row, and scoping these by tenant would leave the most
-- privileged login the one that could not be protected.

-- ── Authenticator app (TOTP) ────────────────────────────────────────────────
--
-- An OPTIONAL upgrade, not a second hurdle. Sign-in already challenges an
-- unrecognised device with an emailed code; someone who enrols here is
-- challenged with their authenticator INSTEAD. It is stronger (no mail in the
-- path, nothing to intercept in a mailbox) and faster, so it replaces the email
-- step rather than stacking on top of it.
--
-- The secret is stored encrypted (AES-256-GCM, key derived from
-- ADMIN_JWT_SECRET via HKDF). A TOTP secret in plaintext is password-equivalent:
-- anyone reading this table could mint valid codes forever.
create table if not exists wa_user_2fa (
  email        text primary key,
  secret       text not null,                  -- AES-256-GCM "v1.<iv>.<tag>.<ct>" base64url
  confirmed_at timestamptz,                    -- null = started, first code never proved
  backup_codes jsonb not null default '[]'::jsonb,  -- scrypt hashes of UNUSED codes only
  last_step    bigint not null default 0,      -- highest TOTP step spent (replay guard)
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on column wa_user_2fa.last_step is
  'Highest 30s TOTP step already accepted. A code whose step is <= this is refused, so the same six digits cannot be replayed inside their own validity window.';

-- ── Passkeys (WebAuthn) ─────────────────────────────────────────────────────
--
-- The only factor here that a convincing fake login page cannot harvest: the
-- browser will not offer a credential to any origin but the one it was created
-- for, so a lookalike domain gets no answer at all. What is stored is a PUBLIC
-- key — useless to whoever reads this table.
create table if not exists wa_user_passkeys (
  id            uuid primary key default gen_random_uuid(),
  email         text not null,
  credential_id text not null unique,
  public_key    text not null,                 -- base64url COSE public key; not a secret
  counter       bigint not null default 0,
  transports    jsonb not null default '[]'::jsonb,
  device_name   text not null default '',
  backed_up     boolean not null default false,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz
);
create index if not exists wa_user_passkeys_email_idx on wa_user_passkeys (email);

comment on column wa_user_passkeys.counter is
  'Signature counter, for cloned-authenticator detection. Synced passkeys (iCloud Keychain, Google Password Manager) legitimately never advance it, so a stalled counter is recorded, never treated as an attack.';

-- ── Password reset ──────────────────────────────────────────────────────────
--
-- Reuses the existing email OTP machinery rather than a parallel one; this just
-- admits a third purpose alongside login and signup.
--
-- The WhatsApp OTP service was the obvious alternative and is the wrong tool:
-- it is a TENANT'S customer-facing product, gated on accountCanSend with their
-- own connected WABA and approved template. Platform sign-in cannot depend on
-- whether a customer has finished onboarding a number, and must not spend their
-- messaging quota on our authentication.
alter table email_otps drop constraint if exists email_otps_purpose_check;
alter table email_otps add constraint email_otps_purpose_check
  check (purpose in ('login', 'signup', 'reset'));

comment on column email_otps.purpose is
  'login = new-device sign-in challenge; signup = address verification before a workspace exists; reset = forgotten password.';
