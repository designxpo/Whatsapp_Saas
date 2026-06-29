-- ── Grounding observability (anti-hallucination, layer L3) ───────────────────
-- Multi-tenant twin of the internal app's 0050. Records what the GroundingFirewall
-- + retrieval-confidence band did per AI reply, and the async semantic auditor's
-- verdicts — so deferrals surface KB gaps and flagged replies are inspectable
-- WITHOUT silencing the bot. Additive + idempotent.

-- 1) Per-message grounding metadata (wa_conv_messages already carries tenant_id).
alter table wa_conv_messages add column if not exists coverage_band      text;             -- 'none' | 'thin' | 'solid'
alter table wa_conv_messages add column if not exists top_sim            double precision;  -- best retrieved-chunk similarity
alter table wa_conv_messages add column if not exists grounding_deferred boolean not null default false;
alter table wa_conv_messages add column if not exists grounding_stripped jsonb;             -- [{cls,original,disposition,replacement}]

-- 2) Close the router↔conversation link.
alter table wa_router_events add column if not exists conversation_id uuid references wa_conversations(id) on delete set null;
create index if not exists wa_router_events_conv_idx on wa_router_events (conversation_id);

-- 3) Async semantic-grounding audit verdicts (tenant-scoped, like every app table).
create table if not exists wa_grounding_audits (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null default '00000000-0000-0000-0000-000000000001' references tenants(id) on delete cascade,
  conversation_id      uuid references wa_conversations(id) on delete cascade,
  message_id           uuid references wa_conv_messages(id) on delete set null,
  question             text,
  reply                text,
  coverage_band        text,
  top_sim              double precision,
  used_chunks          int,
  chunk_sims           double precision[],
  grounded             boolean,
  unsupported_claims   jsonb,
  dropped_subquestions jsonb,
  sanitizer_actions    jsonb,
  model                text,
  created_at           timestamptz not null default now()
);
create index if not exists wa_grounding_audits_tenant_idx  on wa_grounding_audits (tenant_id);
create index if not exists wa_grounding_audits_created_idx  on wa_grounding_audits (created_at desc);
create index if not exists wa_grounding_audits_conv_idx     on wa_grounding_audits (conversation_id);
create index if not exists wa_grounding_audits_flagged_idx  on wa_grounding_audits (created_at desc) where grounded = false;

-- 4) RLS — tenant isolation, matching every other app table (0019).
alter table wa_grounding_audits enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'wa_grounding_audits' and policyname = 'wa_grounding_audits_tenant_isolation') then
    create policy wa_grounding_audits_tenant_isolation on wa_grounding_audits
      using (tenant_id = current_tenant_id())
      with check (tenant_id = current_tenant_id());
  end if;
end $$;
