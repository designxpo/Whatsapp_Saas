-- 20261030120000_conversation_notes.sql — private team notes on a conversation:
-- "called her, wants the EMI option".
--
-- Their own table on purpose, not a row in wa_conv_messages: everything that
-- reads messages would otherwise read notes too — the AI's conversation
-- history, the CRM timeline sync, the analytics counts, and the web chat
-- widget's poll, which sends new messages straight to the visitor's browser.
-- A note must never reach the customer or the model, and the only way to be
-- sure of that is for it not to be a message.
--
-- Idempotent: safe to run twice.

create table if not exists wa_conversation_notes (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  conversation_id uuid not null references wa_conversations(id) on delete cascade,
  -- Who wrote it: the email is the identity (deleting is the author's or an
  -- admin's), the name is what the panel shows.
  author_email    text not null,
  author_name     text not null default '',
  body            text not null check (char_length(body) between 1 and 2000),
  created_at      timestamptz not null default now()
);

-- The panel reads one conversation's notes, newest last.
create index if not exists wa_conversation_notes_conv_idx on wa_conversation_notes (tenant_id, conversation_id, created_at);

-- Defense-in-depth, as everywhere else: the service role bypasses it, direct REST does not.
alter table wa_conversation_notes enable row level security;
drop policy if exists tenant_isolation on wa_conversation_notes;
create policy tenant_isolation on wa_conversation_notes
  using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id());
