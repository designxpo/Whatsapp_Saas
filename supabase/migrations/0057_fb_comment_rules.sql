-- 0057_fb_comment_rules.sql — Facebook comment-to-DM automation (multi-tenant).
-- Mirrors 0031 (Instagram). Multiple rules per tenant, each optionally targeting
-- one Page post, keyword-gated, with a DM payload (text + optional link button)
-- and an optional public reply. No follow-gate — Facebook Pages have no
-- equivalent of Instagram's is_user_follow_business comment flow. All rows
-- tenant-scoped + RLS.

create table if not exists wa_fb_comment_rules (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null default '00000000-0000-0000-0000-000000000001' references tenants(id) on delete cascade,
  channel_id      uuid references wa_channels(id) on delete cascade,
  name            text not null default '',
  enabled         boolean not null default true,
  post_id         text,           -- Page post id ({pageId}_{postId}); null = ALL posts
  post_caption    text,
  post_permalink  text,
  post_thumbnail  text,
  keyword         text,           -- null/'' = any comment
  dm_message      text not null,
  button_label    text,
  button_url      text,
  public_reply    text,
  match_count     int not null default 0,
  created_at      timestamptz not null default now()
);
create index if not exists wa_fb_comment_rules_tenant_idx on wa_fb_comment_rules(tenant_id);
create index if not exists wa_fb_comment_rules_post_idx on wa_fb_comment_rules(post_id);
alter table wa_fb_comment_rules enable row level security;
drop policy if exists tenant_isolation on wa_fb_comment_rules;
create policy tenant_isolation on wa_fb_comment_rules
  using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id());

-- Idempotency: one DM per comment even if Meta redelivers the webhook.
create table if not exists wa_fb_comment_log (
  comment_id  text primary key,
  tenant_id   uuid not null default '00000000-0000-0000-0000-000000000001' references tenants(id) on delete cascade,
  rule_id     uuid,
  created_at  timestamptz not null default now()
);
alter table wa_fb_comment_log enable row level security;
drop policy if exists tenant_isolation on wa_fb_comment_log;
create policy tenant_isolation on wa_fb_comment_log
  using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id());
