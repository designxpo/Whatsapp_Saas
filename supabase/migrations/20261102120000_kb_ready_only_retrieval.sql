-- Document search returns only finished documents, and only document vectors
-- (2026-11 AI security audit).
--
-- The four document match functions filtered by tenant but not by document
-- status, so chunks of a document still 'processing' — or one that 'failed'
-- halfway through a re-embed — could be served as an answer. They also did not
-- exclude concept chunks (kb_chunks.concept_id), which carry their source
-- document's id; the document index therefore also served concept vectors,
-- including those of concepts since superseded, although the two indexes are
-- meant to be separate (match_kb_concept_chunks* read concepts).
--
-- Same names, arguments and return shapes as before (0026, 0047, 0063), so no
-- application change is needed. Rollback: re-run those definitions.

create or replace function match_kb_chunks(
  query_embedding vector(768), match_count int, p_tenant_id uuid
)
returns table (content text, document_id uuid, similarity float)
language sql stable as $$
  select c.content, c.document_id, 1 - (c.embedding <=> query_embedding) as similarity
  from kb_chunks c
  join kb_documents d on d.id = c.document_id
  where c.tenant_id = p_tenant_id and d.tenant_id = p_tenant_id
    and d.status = 'ready' and c.concept_id is null
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

create or replace function match_kb_chunks_by_tag(
  query_embedding vector(768), match_count int, p_tenant_id uuid, doc_tag text
)
returns table (content text, document_id uuid, similarity float)
language sql stable as $$
  select c.content, c.document_id, 1 - (c.embedding <=> query_embedding) as similarity
  from kb_chunks c
  join kb_documents d on d.id = c.document_id
  where c.tenant_id = p_tenant_id and d.tenant_id = p_tenant_id
    and d.status = 'ready' and c.concept_id is null and d.tag = doc_tag
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

create or replace function match_kb_chunks_text(query_text text, match_count int, p_tenant_id uuid)
returns table (content text, document_id uuid, rank float)
language sql stable as $$
  select c.content, c.document_id,
         ts_rank(c.content_tsv, websearch_to_tsquery('english', query_text)) as rank
  from kb_chunks c
  join kb_documents d on d.id = c.document_id
  where c.tenant_id = p_tenant_id and d.tenant_id = p_tenant_id
    and d.status = 'ready' and c.concept_id is null
    and c.content_tsv @@ websearch_to_tsquery('english', query_text)
  order by rank desc
  limit match_count;
$$;

create or replace function match_kb_chunks_text_by_tag(query_text text, match_count int, p_tenant_id uuid, doc_tag text)
returns table (content text, document_id uuid, rank float)
language sql stable as $$
  select c.content, c.document_id,
         ts_rank(c.content_tsv, websearch_to_tsquery('english', query_text)) as rank
  from kb_chunks c
  join kb_documents d on d.id = c.document_id
  where c.tenant_id = p_tenant_id and d.tenant_id = p_tenant_id
    and d.status = 'ready' and c.concept_id is null and d.tag = doc_tag
    and c.content_tsv @@ websearch_to_tsquery('english', query_text)
  order by rank desc
  limit match_count;
$$;
