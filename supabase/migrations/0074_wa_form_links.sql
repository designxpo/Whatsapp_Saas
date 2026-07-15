-- ── Cross-WABA WhatsApp form replicas ─────────────────────────────────────────
-- A WhatsApp Form (Meta "Flow") is bound to the ONE WABA it was created on, so a
-- chatbot flow's form node can only send it from a number on that same WABA. A
-- number brought on via partner access lives on its own WABA, so the native form
-- was rejected there (it now degrades to chat Q&A — see the 0072/0073 era fixes).
--
-- The "Publish to all numbers" action clones a form's fields and publishes an
-- identical copy on every OTHER connected WABA, recording source id -> copy id
-- here. At send time the flow engine looks up the copy that matches the sending
-- number's WABA, so the native tappable form works from any number.
--
--   source_form_id : the original form (the id stored on the flow's form node)
--   waba_id        : a WABA the form was replicated onto
--   form_id        : the published copy's Flow id on that WABA
--
-- Additive + idempotent.

create table if not exists wa_form_links (
  tenant_id      uuid not null default '00000000-0000-0000-0000-000000000001' references tenants(id) on delete cascade,
  source_form_id text not null,
  waba_id        text not null,
  form_id        text not null,
  name           text,
  status         text,
  updated_at     timestamptz not null default now(),
  primary key (tenant_id, source_form_id, waba_id)
);

comment on table wa_form_links is
  'Cross-WABA WhatsApp form replicas: source form id -> published copy Flow id per WABA. Lets a flow send one form natively from any number.';

-- RLS backstop (service role bypasses; denies the public anon/authenticated roles).
alter table wa_form_links enable row level security;
