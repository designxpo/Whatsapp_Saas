-- 20261101120000_comment_replies.sql — every public comment reply the product
-- posts on YouTube, Instagram and Facebook, so the team can read them and fix
-- a wrong one.
--
-- Before this, a YouTube reply left no record at all (only the newest reply's
-- id on the channel), and Instagram/Facebook replies were mirrored into Live
-- Chat as text without the id of the posted comment — which is what editing or
-- deleting it on the platform needs.
--
-- One row per reply we posted. Editing on YouTube/Facebook changes the comment
-- in place; Instagram cannot edit a comment, so a correction posts a new reply
-- and removes the old one, and the row then points at the new reply.
--
-- Idempotent: safe to run twice.

create table if not exists wa_comment_replies (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  channel_id        uuid references wa_channels(id) on delete set null,
  platform          text not null check (platform in ('youtube', 'instagram', 'facebook')),
  -- The customer's comment we answered, and what it said.
  parent_comment_id text not null,
  comment_text      text,
  comment_author    text,
  -- The video / media / post it sits under, when known.
  post_id           text,
  -- Our reply as it stands on the platform now.
  reply_id          text not null,
  reply_text        text not null,
  source            text not null default 'ai' check (source in ('ai', 'rule', 'ai_followup', 'manual')),
  status            text not null default 'sent' check (status in ('sent', 'edited', 'deleted')),
  edited_at         timestamptz,
  edited_by         text,
  created_at        timestamptz not null default now()
);

-- A reply is recorded once, whatever retries happen around it.
create unique index if not exists wa_comment_replies_reply_uq on wa_comment_replies (platform, reply_id);
-- The section lists one platform's replies, newest first.
create index if not exists wa_comment_replies_list_idx on wa_comment_replies (tenant_id, platform, created_at desc);

-- Defense-in-depth, as everywhere else: the service role bypasses it, direct REST does not.
alter table wa_comment_replies enable row level security;
drop policy if exists tenant_isolation on wa_comment_replies;
create policy tenant_isolation on wa_comment_replies
  using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id());
