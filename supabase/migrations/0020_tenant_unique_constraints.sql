-- 0020_tenant_unique_constraints.sql — make uniqueness tenant-scoped.
--
-- After 0019 every table has tenant_id, but the ORIGINAL uniqueness is still
-- GLOBAL. Two tenants would collide on the same phone/key/shortcut, and — worst
-- of all — the semantic cache (normalized_question) would serve one tenant's
-- answers to another. This migration rescopes each business-key uniqueness to
-- include tenant_id.
--
-- Verified safe: no foreign key references any of the columns changed here
-- (the only FKs point at contacts(id) and wa_conversations(id), untouched).
--
-- Tables whose business key WAS the primary key (wa_optouts, wa_settings,
-- wa_template_meta) get a COMPOSITE primary key (tenant_id, <key>). Tables with
-- a surrogate id PK keep it and swap their secondary unique for a composite one.
--
-- Left intentionally GLOBAL-unique (Meta-global ids / one-per-platform):
--   wa_channels.phone_number_id, wa_conv_messages.meta_message_id,
--   wa_links.code, wa_users.email.

-- Helper: drop a constraint if present, then (re)add a composite unique.
-- Idempotent via pg_constraint existence checks.
do $$
declare
  r record;
  -- {table, business cols (comma-sep), old single/table unique constraint, is the old one the PK?}
  specs jsonb := '[
    {"t":"contacts",            "cols":"phone",               "old":"contacts_phone_key",                  "pk":false},
    {"t":"wa_conversations",    "cols":"phone",               "old":"wa_conversations_phone_key",          "pk":false},
    {"t":"wa_quick_replies",    "cols":"shortcut",            "old":"wa_quick_replies_shortcut_key",       "pk":false},
    {"t":"wa_ai_functions",     "cols":"name",                "old":"wa_ai_functions_name_key",            "pk":false},
    {"t":"wa_ad_flow_triggers", "cols":"scope, ref_id",       "old":"wa_ad_flow_triggers_scope_ref_id_key","pk":false},
    {"t":"wa_optouts",          "cols":"phone",               "old":"wa_optouts_pkey",                     "pk":true},
    {"t":"wa_settings",         "cols":"key",                 "old":"wa_settings_pkey",                    "pk":true},
    {"t":"wa_template_meta",    "cols":"template_name",       "old":"wa_template_meta_pkey",               "pk":true}
  ]'::jsonb;
  newname text;
begin
  for r in select * from jsonb_array_elements(specs) as e(o) loop
    continue when to_regclass(r.o->>'t') is null;

    -- 1. drop the global constraint (PK or unique)
    execute format('alter table %I drop constraint if exists %I',
                   r.o->>'t', r.o->>'old');

    if (r.o->>'pk')::boolean then
      -- 2a. business key was the PK → recreate as composite PK
      if not exists (
        select 1 from pg_constraint
        where conrelid = (r.o->>'t')::regclass and contype = 'p'
      ) then
        execute format('alter table %I add primary key (tenant_id, %s)',
                       r.o->>'t', r.o->>'cols');
      end if;
    else
      -- 2b. surrogate id PK stays → add composite UNIQUE on (tenant_id, cols)
      newname := (r.o->>'t') || '_tenant_uq';
      if not exists (
        select 1 from pg_constraint
        where conrelid = (r.o->>'t')::regclass and conname = newname
      ) then
        execute format('alter table %I add constraint %I unique (tenant_id, %s)',
                       r.o->>'t', newname, r.o->>'cols');
      end if;
    end if;
  end loop;
end $$;

-- wa_semantic_cache uses a UNIQUE INDEX (not a constraint) on normalized_question.
-- Rescope it to the tenant — THIS is the cross-tenant cache-leak fix.
drop index if exists wa_semantic_cache_norm_idx;
create unique index if not exists wa_semantic_cache_norm_idx
  on wa_semantic_cache (tenant_id, normalized_question);

-- Tenant-aware vector search (3-arg overload; the 2-arg version from 0005
-- stays for backward compat). The app calls THIS one so similarity matches
-- never cross tenants.
create or replace function match_semantic_cache(
  query_embedding vector(768), match_count int, p_tenant_id uuid
)
returns table (id uuid, question text, answer text, source text, similarity float)
language sql stable as $$
  select c.id, c.question, c.answer, c.source,
         1 - (c.embedding <=> query_embedding) as similarity
  from wa_semantic_cache c
  where c.tenant_id = p_tenant_id
  order by c.embedding <=> query_embedding
  limit match_count;
$$;
