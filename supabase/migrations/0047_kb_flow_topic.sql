-- Per-flow primary knowledge. Tag KB documents to a topic, let a flow declare a
-- "primary knowledge" tag, and remember which tag a conversation is scoped to.
-- AI retrieval then prefers the conversation's tagged docs (e.g. a masterclass)
-- and falls back to the rest of the knowledge base for off-topic questions.
-- All columns nullable; the app degrades to global KB retrieval if absent.
alter table kb_documents     add column if not exists tag text;
alter table wa_flows         add column if not exists primary_kb_tag text;
alter table wa_conversations add column if not exists primary_kb_tag text;
create index if not exists kb_docs_tag_idx on kb_documents (tag);

-- Tenant-scoped, tag-filtered vector search (mirror of match_kb_chunks + a tag join).
create or replace function match_kb_chunks_by_tag(
  query_embedding vector(768), match_count int, p_tenant_id uuid, doc_tag text
)
returns table (content text, document_id uuid, similarity float)
language sql stable as $$
  select c.content, c.document_id, 1 - (c.embedding <=> query_embedding) as similarity
  from kb_chunks c
  join kb_documents d on d.id = c.document_id
  where c.tenant_id = p_tenant_id and d.tag = doc_tag
  order by c.embedding <=> query_embedding
  limit match_count;
$$;
