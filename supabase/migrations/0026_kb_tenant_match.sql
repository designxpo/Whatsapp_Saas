-- 0026_kb_tenant_match.sql — tenant-scope the KB vector search.
--
-- match_kb_chunks previously searched ALL tenants' chunks. In multi-tenant mode
-- that would let one tenant's RAG answers ground on another tenant's documents.
-- This adds p_tenant_id and filters by it (same pattern as match_semantic_cache
-- in 0020). kb_chunks.tenant_id is backfilled in 0019.
create or replace function match_kb_chunks(
  query_embedding vector(768), match_count int, p_tenant_id uuid
)
returns table (content text, document_id uuid, similarity float)
language sql stable as $$
  select c.content, c.document_id, 1 - (c.embedding <=> query_embedding) as similarity
  from kb_chunks c
  where c.tenant_id = p_tenant_id
  order by c.embedding <=> query_embedding
  limit match_count;
$$;
