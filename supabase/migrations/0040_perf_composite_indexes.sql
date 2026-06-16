-- 0040_perf_composite_indexes.sql — composite indexes matching the real hot-path
-- access patterns. The 0019 tenancy retrofit added only single-column (tenant_id)
-- indexes, so multi-predicate queries (audience build, daily-cap count, queue
-- claim ordering, conversation list) filter on tenant_id then do residual work.
-- These composites keep those queries index-backed as tables grow to millions.
--
-- NOTE: on a large live table prefer `create index concurrently` (cannot run in a
-- migration transaction). These use IF NOT EXISTS to stay idempotent and match the
-- existing migration style; they are safe to run on small/empty tables.

-- recipientsForAudience: where tenant_id = ? and status = 'active'
create index if not exists contacts_tenant_status_idx
  on contacts (tenant_id, status);

-- contact list pagination: where tenant_id = ? order by created_at desc
create index if not exists contacts_tenant_created_idx
  on contacts (tenant_id, created_at desc);

-- dailySentCount / getTenantUsage: where tenant_id = ? and sent_at >= ?
create index if not exists wsl_tenant_sent_idx
  on wa_send_log (tenant_id, sent_at);

-- claimPending: where campaign_id = ? and status = 'pending' order by created_at
-- (the existing partial wsq_pending_idx covers the equality but not the sort).
create index if not exists wsq_campaign_status_created_idx
  on wa_send_queue (campaign_id, status, created_at);

-- listConversations: where tenant_id = ? order by last_inbound_at desc
create index if not exists wa_conv_tenant_inbound_idx
  on wa_conversations (tenant_id, last_inbound_at desc);
