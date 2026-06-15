-- 0031_ig_comment_rules.sql — ManyChat-style comment automation (multi-tenant).
-- Multiple rules per tenant, each optionally targeting one post, keyword-gated,
-- with a DM payload (text + optional link button), optional public reply, and
-- an optional follow-to-unlock gate. All rows tenant-scoped + RLS.

create table if not exists wa_ig_comment_rules (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null default '00000000-0000-0000-0000-000000000001' references tenants(id) on delete cascade,
  channel_id      uuid references wa_channels(id) on delete cascade,
  name            text not null default '',
  enabled         boolean not null default true,
  post_id         text,           -- IG media id; null = ALL posts
  post_caption    text,
  post_permalink  text,
  post_thumbnail  text,
  keyword         text,           -- null/'' = any comment
  dm_message      text not null,
  button_label    text,
  button_url      text,
  public_reply    text,
  require_follow  boolean not null default false,
  follow_prompt   text,
  match_count     int not null default 0,
  created_at      timestamptz not null default now()
);
create index if not exists wa_ig_comment_rules_tenant_idx on wa_ig_comment_rules(tenant_id);
create index if not exists wa_ig_comment_rules_post_idx on wa_ig_comment_rules(post_id);
alter table wa_ig_comment_rules enable row level security;
drop policy if exists tenant_isolation on wa_ig_comment_rules;
create policy tenant_isolation on wa_ig_comment_rules
  using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id());

-- Idempotency: one DM per comment even if Meta redelivers the webhook.
create table if not exists wa_ig_comment_log (
  comment_id  text primary key,
  tenant_id   uuid not null default '00000000-0000-0000-0000-000000000001' references tenants(id) on delete cascade,
  rule_id     uuid,
  created_at  timestamptz not null default now()
);
alter table wa_ig_comment_log enable row level security;
drop policy if exists tenant_isolation on wa_ig_comment_log;
create policy tenant_isolation on wa_ig_comment_log
  using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id());

-- Pending follow gates: which reward (rule) a user must follow to unlock.
create table if not exists wa_ig_follow_gates (
  igsid       text not null,
  tenant_id   uuid not null default '00000000-0000-0000-0000-000000000001' references tenants(id) on delete cascade,
  rule_id     uuid not null,
  channel_id  uuid,
  created_at  timestamptz not null default now(),
  primary key (tenant_id, igsid)
);
alter table wa_ig_follow_gates enable row level security;
drop policy if exists tenant_isolation on wa_ig_follow_gates;
create policy tenant_isolation on wa_ig_follow_gates
  using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id());
