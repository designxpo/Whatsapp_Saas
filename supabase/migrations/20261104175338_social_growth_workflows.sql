-- Social campaigns, evidence-backed outcomes, reviewed commitments and explicit
-- cross-channel continuity. No new outbound messaging permission or scheduler.
create table public.wa_social_campaigns (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references tenants(id) on delete cascade,
 name text not null, audience text not null default 'business' check (audience in ('business','creator')),
 channel_id uuid not null references wa_channels(id) on delete cascade,
 platform text not null check (platform in ('instagram','messenger')), post_id text,
 keyword text not null default '', facts text not null default '', questions jsonb not null default '[]',
 goal text not null default 'lead' check (goal in ('lead','booking','purchase','sponsorship')),
 status text not null default 'draft' check (status in ('draft','active','paused')),
 expires_at timestamptz, variants jsonb not null default '[]', created_at timestamptz not null default now(),
 unique (tenant_id,id)
);
create index social_campaign_match_idx on public.wa_social_campaigns(tenant_id,channel_id,created_at desc) where status='active';
create table public.wa_social_journeys (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references tenants(id) on delete cascade,
 campaign_id uuid not null, conversation_id uuid not null references wa_conversations(id) on delete cascade,
 root_journey_id uuid, contact_key text not null, platform text not null, variant text, answers jsonb not null default '{}',
 context jsonb not null default '[]', enrolled_at timestamptz not null default now(),
 unique (tenant_id,id), unique(tenant_id,campaign_id,conversation_id),
 foreign key(tenant_id,root_journey_id) references public.wa_social_journeys(tenant_id,id) on delete cascade,
 foreign key(tenant_id,campaign_id) references public.wa_social_campaigns(tenant_id,id) on delete cascade
);
create index social_journey_conversation_idx on public.wa_social_journeys(tenant_id,conversation_id,enrolled_at desc);
create index social_journey_contact_idx on public.wa_social_journeys(tenant_id,contact_key,enrolled_at desc);
create table public.wa_social_outcomes (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references tenants(id) on delete cascade,
 journey_id uuid not null, event_key text not null, kind text not null check(kind in ('lead','booking','purchase','sponsorship')),
 amount_cents bigint not null default 0 check(amount_cents>=0), currency text not null default 'INR' check(currency ~ '^[A-Z]{3}$'),
 evidence text not null check(evidence in ('manual','payment')), reference text not null,
 created_at timestamptz not null default now(), unique(tenant_id,event_key), unique(tenant_id,kind,reference),
 foreign key(tenant_id,journey_id) references public.wa_social_journeys(tenant_id,id) on delete cascade
);
create index social_outcome_journey_idx on public.wa_social_outcomes(tenant_id,journey_id,created_at desc);
create table public.wa_social_commitments (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references tenants(id) on delete cascade,
 conversation_id uuid not null references wa_conversations(id) on delete cascade,
 message_id uuid references wa_conv_messages(id) on delete cascade,
 title text not null, evidence text not null, owner_email text, due_at timestamptz,
 status text not null default 'needs_review' check(status in ('needs_review','open','done','dismissed')),
 reviewed_by text, created_at timestamptz not null default now(), completed_at timestamptz,
 unique(tenant_id,message_id), check(status <> 'open' or (owner_email is not null and due_at is not null))
);
create index social_commitment_due_idx on public.wa_social_commitments(tenant_id,status,due_at);
create table public.wa_social_links (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references tenants(id) on delete cascade,
 handoff_id uuid not null references wa_handoffs(id) on delete cascade,
 source_conversation_id uuid not null references wa_conversations(id) on delete cascade,
 target_conversation_id uuid not null references wa_conversations(id) on delete cascade,
 created_at timestamptz not null default now(), unique(tenant_id,handoff_id)
);
create index social_links_source_idx on public.wa_social_links(tenant_id,source_conversation_id);
create index social_links_target_idx on public.wa_social_links(tenant_id,target_conversation_id);
alter table public.wa_handoffs add column source_conversation_id uuid references wa_conversations(id) on delete set null;

-- Match the project's session tenant policy. Service access also scopes EVERY query.
alter table public.wa_social_campaigns enable row level security;
alter table public.wa_social_journeys enable row level security;
alter table public.wa_social_outcomes enable row level security;
alter table public.wa_social_commitments enable row level security;
alter table public.wa_social_links enable row level security;
create policy tenant_isolation on public.wa_social_campaigns using(tenant_id=current_tenant_id()) with check(tenant_id=current_tenant_id());
create policy tenant_isolation on public.wa_social_journeys using(tenant_id=current_tenant_id()) with check(tenant_id=current_tenant_id());
create policy tenant_isolation on public.wa_social_outcomes using(tenant_id=current_tenant_id()) with check(tenant_id=current_tenant_id());
create policy tenant_isolation on public.wa_social_commitments using(tenant_id=current_tenant_id()) with check(tenant_id=current_tenant_id());
create policy tenant_isolation on public.wa_social_links using(tenant_id=current_tenant_id()) with check(tenant_id=current_tenant_id());
-- Access these through the authenticated, admin-checked server routes only.
revoke all on public.wa_social_campaigns, public.wa_social_journeys, public.wa_social_outcomes,
 public.wa_social_commitments, public.wa_social_links from anon, authenticated;
grant all on public.wa_social_campaigns, public.wa_social_journeys, public.wa_social_outcomes,
 public.wa_social_commitments, public.wa_social_links to service_role;
