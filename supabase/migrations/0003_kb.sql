-- Knowledge base: business documents chunked + embedded for RAG.
-- Embedding dimension is 768 — MUST match GEMINI_EMBED_MODEL output
-- (gemini-embedding-001 with outputDimensionality: 768). Changing it requires
-- re-embedding every chunk.

create extension if not exists vector;

-- ── Documents (one row per ingested source) ──────────────────────────────────
create table if not exists kb_documents (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  source_type text not null check (source_type in ('pdf','docx','text','url')),
  source_ref  text,                                  -- filename or URL
  status      text not null default 'processing'
                check (status in ('processing','ready','failed')),
  error       text,
  chunk_count int not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists kb_docs_created_idx on kb_documents (created_at desc);

-- ── Chunks (embedded text segments) ──────────────────────────────────────────
create table if not exists kb_chunks (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references kb_documents(id) on delete cascade,
  chunk_index int not null,
  content     text not null,
  embedding   vector(768) not null,
  created_at  timestamptz not null default now()
);
create index if not exists kb_chunks_doc_idx on kb_chunks (document_id);
create index if not exists kb_chunks_embedding_idx on kb_chunks
  using hnsw (embedding vector_cosine_ops);

-- ── Retrieval: top-k chunks by cosine similarity ─────────────────────────────
create or replace function match_kb_chunks(query_embedding vector(768), match_count int)
returns table (content text, document_id uuid, similarity float)
language sql stable as $$
  select c.content, c.document_id, 1 - (c.embedding <=> query_embedding) as similarity
  from kb_chunks c
  order by c.embedding <=> query_embedding
  limit match_count;
$$;
