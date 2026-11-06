-- Phase 4 "industry setup packs" + knowledge-base checks.
--
-- wa_kb_tests: questions a business expects its AI to answer correctly, with
-- words a right answer must include (and must not), or that it should hand
-- over to a person. Run on demand; the last result is kept on the row.
-- kb_documents.review_by: when a document should be checked for being out of
-- date (a price list, timings, a policy). Documents past it are listed.

create table if not exists wa_kb_tests (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  question       text not null check (char_length(question) between 3 and 500),
  must_include   text[] not null default '{}',
  must_avoid     text[] not null default '{}',
  expect_handoff boolean not null default false,
  source         text not null default 'manual',   -- 'manual' or the setup pack that added it
  last_run_at    timestamptz,
  last_passed    boolean,
  last_reply     text,
  last_detail    text,
  created_at     timestamptz not null default now(),
  unique (tenant_id, question)
);
create index if not exists wa_kb_tests_tenant_idx on wa_kb_tests (tenant_id, created_at);
alter table wa_kb_tests enable row level security;
drop policy if exists tenant_isolation on wa_kb_tests;
create policy tenant_isolation on wa_kb_tests using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id());

alter table kb_documents add column if not exists review_by date;
