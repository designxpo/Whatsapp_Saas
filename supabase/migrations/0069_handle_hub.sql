-- ── Handle Hub — tracked WhatsApp entry points ─────────────────────────────
-- The near-term, no-Meta-API piece of the WhatsApp-username plan: one branded
-- entry point (the tenant's number today, a @handle later) surfaced everywhere
-- (QR, link-in-bio, ad, email footer) as a per-source TRACKED link. Each source
-- carries a short ref code embedded in the click-to-chat prefilled text; the
-- inbound webhook reads it, so every conversation's origin is attributed.
--
-- Additive + idempotent. Per-tenant config (number / handle / greeting) lives in
-- wa_settings — no schema needed for those.

create table if not exists wa_handle_sources (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,
  label         text not null,                 -- e.g. "Instagram bio", "Store QR", "Diwali ad"
  ref_code      text not null,                 -- short token embedded in the tracked link
  kind          text not null default 'link',  -- link | qr | bio | ad | other (cosmetic)
  touches       int  not null default 0,       -- conversations started from this source
  last_touch_at timestamptz,
  created_at    timestamptz not null default now()
);

-- One ref code per tenant; fast per-tenant listing.
create unique index if not exists wa_handle_sources_tenant_ref_idx on wa_handle_sources (tenant_id, ref_code);
create index if not exists wa_handle_sources_tenant_idx on wa_handle_sources (tenant_id, created_at desc);

-- RLS backstop (service role bypasses; denies the public anon/authenticated roles).
alter table wa_handle_sources enable row level security;
