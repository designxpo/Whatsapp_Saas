-- Hybrid retrieval: add Postgres full-text search over chunks so exact terms
-- (course names, acronyms like "PGP", numbers, dates) that pure vector search
-- misses are still recovered. The app fuses these keyword hits with the vector
-- hits via Reciprocal Rank Fusion (lib/kb.ts). Tenant-scoped, mirroring
-- match_kb_chunks (0026) and match_kb_chunks_by_tag (0047). Until applied, the
-- keyword RPCs error and the app degrades to vector-only retrieval.

-- Prerequisite from 0047: the kb_documents.tag column this migration filters on.
-- Guarded (idempotent) so 0063 applies even if 0047 hasn't run yet. NOTE: 0047
-- also defines the tag-scoped VECTOR RPC (match_kb_chunks_by_tag) — apply 0047 in
-- full so tag-scoped AI retrieval works, not just this keyword half.
alter table kb_documents add column if not exists tag text;
create index if not exists kb_docs_tag_idx on kb_documents (tag);

-- A maintained tsvector of each chunk's text + a GIN index for fast @@ matching.
alter table kb_chunks add column if not exists content_tsv tsvector
  generated always as (to_tsvector('english', content)) stored;
create index if not exists kb_chunks_tsv_idx on kb_chunks using gin (content_tsv);

-- Tenant-scoped keyword search: top-k chunks by text rank. An empty or
-- lexeme-free query yields an empty tsquery → no rows (safe).
create or replace function match_kb_chunks_text(query_text text, match_count int, p_tenant_id uuid)
returns table (content text, document_id uuid, rank float)
language sql stable as $$
  select c.content, c.document_id,
         ts_rank(c.content_tsv, websearch_to_tsquery('english', query_text)) as rank
  from kb_chunks c
  where c.tenant_id = p_tenant_id and c.content_tsv @@ websearch_to_tsquery('english', query_text)
  order by rank desc
  limit match_count;
$$;

-- Tenant-scoped, tag-filtered keyword search (mirror of match_kb_chunks_by_tag) —
-- keeps course isolation for flow-scoped chats while recovering exact-term matches.
create or replace function match_kb_chunks_text_by_tag(query_text text, match_count int, p_tenant_id uuid, doc_tag text)
returns table (content text, document_id uuid, rank float)
language sql stable as $$
  select c.content, c.document_id,
         ts_rank(c.content_tsv, websearch_to_tsquery('english', query_text)) as rank
  from kb_chunks c
  join kb_documents d on d.id = c.document_id
  where c.tenant_id = p_tenant_id and d.tag = doc_tag
        and c.content_tsv @@ websearch_to_tsquery('english', query_text)
  order by rank desc
  limit match_count;
$$;
