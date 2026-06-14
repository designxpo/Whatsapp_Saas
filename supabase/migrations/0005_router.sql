-- Knowledge Router layer: semantic cache, router observability, conversation memory.

-- Semantic cache — global across all users. Answers produced by RAG are stored
-- with their question embedding; close-enough future questions reuse the answer.
create table if not exists wa_semantic_cache (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  normalized_question text not null,
  answer text not null,
  source text not null default 'rag',          -- rag | faq (what produced the answer)
  embedding vector(768) not null,
  hit_count int not null default 0,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now()
);
create index if not exists wa_semantic_cache_embedding_idx
  on wa_semantic_cache using hnsw (embedding vector_cosine_ops);
create unique index if not exists wa_semantic_cache_norm_idx
  on wa_semantic_cache (normalized_question);

create or replace function match_semantic_cache(query_embedding vector(768), match_count int default 1)
returns table (id uuid, question text, answer text, source text, similarity float)
language sql stable as $$
  select c.id, c.question, c.answer, c.source,
         1 - (c.embedding <=> query_embedding) as similarity
  from wa_semantic_cache c
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

-- Router observability — one row per routing decision.
create table if not exists wa_router_events (
  id uuid primary key default gen_random_uuid(),
  event text not null,                          -- FAQ_MATCH | FAQ_MISS | CACHE_HIT | CACHE_MISS | MEMORY_HIT | MEMORY_MISS | RAG_USED
  phone text,
  question text,
  ref text,                                     -- faq id / cache id that matched
  score double precision,
  latency_ms int,
  created_at timestamptz not null default now()
);
create index if not exists wa_router_events_created_idx on wa_router_events (created_at desc);
create index if not exists wa_router_events_event_idx on wa_router_events (event);

-- Per-conversation router memory: last FAQ id, category, intent.
alter table wa_conversations add column if not exists memory jsonb not null default '{}';
