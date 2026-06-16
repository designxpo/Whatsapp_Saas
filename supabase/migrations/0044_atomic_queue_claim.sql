-- 0044_atomic_queue_claim.sql — atomic send-queue claiming so the queue can be
-- drained by MULTIPLE concurrent workers / overlapping cron runs without
-- double-sending. Previously claimPending did a plain SELECT and rows stayed
-- 'pending' until after the send, so two concurrent drains could claim the same
-- rows. This is the foundation for horizontal send workers (the path to 1M).
--
-- Approach: a claimed_at marker + SELECT ... FOR UPDATE SKIP LOCKED. Claimed rows
-- are skipped by other claimers; a claim older than 10 min is considered stale
-- (worker crashed mid-send) and becomes reclaimable, so nothing is lost.

alter table wa_send_queue add column if not exists claimed_at timestamptz;

-- Partial index for the claim hot path (pending, oldest first).
create index if not exists wsq_claim_idx on wa_send_queue (campaign_id, created_at) where status = 'pending';

create or replace function claim_send_queue(p_campaign uuid, p_limit int)
returns table (id uuid, phone text, recipient_name text)
language sql
as $$
  update wa_send_queue q
     set claimed_at = now()
   where q.id in (
     select s.id
       from wa_send_queue s
      where s.campaign_id = p_campaign
        and s.status = 'pending'
        and (s.claimed_at is null or s.claimed_at < now() - interval '10 minutes')
      order by s.created_at
      limit p_limit
      for update skip locked
   )
  returning q.id, q.phone, q.recipient_name;
$$;
