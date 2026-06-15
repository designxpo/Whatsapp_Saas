-- Drop the pre-tenancy 2-arg vector-match RPCs. The tenant-scoped 3-arg
-- overloads (with p_tenant_id, from 0020/0026) fully replace them. Leaving the
-- old signatures around is a latent cross-tenant leak: a caller omitting the
-- tenant arg would match across all tenants. No code path calls the 2-arg form.
drop function if exists public.match_kb_chunks(vector, integer);
drop function if exists public.match_semantic_cache(vector, integer);
