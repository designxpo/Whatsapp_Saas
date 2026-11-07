-- 20261107120000_affiliate_payouts.sql — automated, fraud-resistant affiliate
-- payouts (RazorpayX). Idempotent: safe to re-run.
--
-- Money model (paise, called "cents" in field names throughout the codebase):
--   * wa_affiliate_commissions rows of kind 'earning' become payable at
--     payable_at (payment date + hold, 10 days by default) unless flagged.
--   * A refund/chargeback before a row is claimed voids it; after it is
--     claimed (processing/paid) a kind 'clawback' row with NEGATIVE
--     commission_cents is written and netted off the next payout.
--   * claim_affiliate_payout() is the ONLY way rows enter a payout. It locks the
--     affiliate row, so two concurrent claims serialise and the second finds
--     nothing left to claim.
--   * Rows are released (release_affiliate_payout) when a payout fails or is
--     cancelled, and settled (mark_affiliate_payout_paid) when it is paid.

-- ── wa_affiliates: payout destination + risk state ─────────────────────────
alter table wa_affiliates add column if not exists payout_kind text;
alter table wa_affiliates add column if not exists payout_details_enc text;      -- encryptSecret(JSON); NEVER returned by any API
alter table wa_affiliates add column if not exists payout_name text;
alter table wa_affiliates add column if not exists payout_last4 text;
alter table wa_affiliates add column if not exists payout_verified_at timestamptz;
alter table wa_affiliates add column if not exists payout_changed_at timestamptz;
alter table wa_affiliates add column if not exists rzpx_contact_id text;
alter table wa_affiliates add column if not exists rzpx_fund_account_id text;
alter table wa_affiliates add column if not exists risk_hold boolean not null default false;
alter table wa_affiliates add column if not exists risk_note text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'wa_affiliates_payout_kind_check') then
    alter table wa_affiliates add constraint wa_affiliates_payout_kind_check check (payout_kind is null or payout_kind in ('upi','bank'));
  end if;
end $$;

-- ── wa_affiliate_commissions: payment link, hold, flags, payout link ───────
alter table wa_affiliate_commissions add column if not exists provider_payment_id text;
alter table wa_affiliate_commissions add column if not exists payable_at timestamptz;
alter table wa_affiliate_commissions add column if not exists flagged boolean not null default false;
alter table wa_affiliate_commissions add column if not exists flag_reason text;
alter table wa_affiliate_commissions add column if not exists payout_id uuid;
alter table wa_affiliate_commissions add column if not exists kind text not null default 'earning';
alter table wa_affiliate_commissions add column if not exists ref_commission_id uuid references wa_affiliate_commissions(id) on delete set null;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'wa_affiliate_commissions_kind_check') then
    alter table wa_affiliate_commissions add constraint wa_affiliate_commissions_kind_check check (kind in ('earning','clawback'));
  end if;
end $$;

-- Widen the status check. The original constraint was auto-named by Postgres,
-- so find any check constraint on this table that mentions the status column
-- (and is not ours) rather than assuming its name.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'wa_affiliate_commissions'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
      and conname <> 'wa_affiliate_commissions_status_v2_check'
  loop
    execute format('alter table wa_affiliate_commissions drop constraint %I', c.conname);
  end loop;
  if not exists (select 1 from pg_constraint where conname = 'wa_affiliate_commissions_status_v2_check') then
    alter table wa_affiliate_commissions add constraint wa_affiliate_commissions_status_v2_check
      check (status in ('pending','processing','paid','void'));
  end if;
end $$;

-- One earning per provider payment: a webhook redelivery, or the verify route
-- and the webhook both reporting the same charge, land on one row.
create unique index if not exists wa_affiliate_commissions_provider_payment_uq
  on wa_affiliate_commissions (provider_payment_id) where kind = 'earning' and provider_payment_id is not null;
-- A refund event redelivered must not write a second clawback for the same earning.
create unique index if not exists wa_affiliate_commissions_clawback_ref_uq
  on wa_affiliate_commissions (ref_commission_id) where kind = 'clawback' and ref_commission_id is not null;
create index if not exists wa_affiliate_commissions_payable_idx
  on wa_affiliate_commissions (affiliate_id, payable_at) where status = 'pending' and payout_id is null;
create index if not exists wa_affiliate_commissions_payout_idx
  on wa_affiliate_commissions (payout_id) where payout_id is not null;

-- ── wa_affiliate_payouts ───────────────────────────────────────────────────
create table if not exists wa_affiliate_payouts (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references wa_affiliates(id) on delete cascade,
  amount_cents int not null check (amount_cents > 0),
  status text not null default 'awaiting_approval'
    check (status in ('awaiting_approval','approved','processing','paid','failed','reversed','cancelled')),
  rzp_payout_id text,
  idempotency_key text not null unique,
  approved_by text,
  approved_at timestamptz,
  failure_reason text,
  utr text,
  payout_snapshot jsonb not null default '{}'::jsonb,   -- masked destination at claim time: {kind,last4,name,fund_account_id}
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists wa_affiliate_payouts_affiliate_idx on wa_affiliate_payouts (affiliate_id, created_at desc);
create index if not exists wa_affiliate_payouts_status_idx on wa_affiliate_payouts (status, created_at desc);
create unique index if not exists wa_affiliate_payouts_rzp_uq on wa_affiliate_payouts (rzp_payout_id) where rzp_payout_id is not null;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'wa_affiliate_commissions_payout_fk') then
    alter table wa_affiliate_commissions add constraint wa_affiliate_commissions_payout_fk
      foreign key (payout_id) references wa_affiliate_payouts(id) on delete set null;
  end if;
end $$;

-- The app only ever uses the service-role key (bypasses RLS). Enabling RLS with
-- no policies makes these tables unreadable through the public anon key, which
-- matters here because wa_affiliates now holds an encrypted bank/UPI blob.
alter table wa_affiliates enable row level security;
alter table wa_affiliate_commissions enable row level security;
alter table wa_affiliate_payouts enable row level security;

-- ── claim ──────────────────────────────────────────────────────────────────
-- Returns the new payout id, or NULL when nothing may be paid right now.
-- Refuses (NULL) when: affiliate missing / not active / risk_hold; payout
-- destination missing or not verified (or verification older than the last
-- change); destination changed within 7 days; a payout is already open for the
-- affiliate; net < p_min_cents. Takes earnings oldest-first while their running
-- total stays within p_max_cents, then nets ALL the affiliate's unapplied
-- clawbacks (negative amounts) off it.
create or replace function claim_affiliate_payout(p_affiliate uuid, p_min_cents int, p_max_cents int, p_hold interval)
returns uuid
language plpgsql
as $$
declare
  a wa_affiliates%rowtype;
  v_earn_ids uuid[]; v_earn bigint := 0;
  v_claw_ids uuid[]; v_claw bigint := 0;
  v_net bigint;
  v_id uuid := gen_random_uuid();
begin
  select * into a from wa_affiliates where id = p_affiliate for update;
  if not found then return null; end if;
  if a.status <> 'active' or a.risk_hold then return null; end if;
  if a.payout_kind is null or a.rzpx_fund_account_id is null or a.payout_verified_at is null or a.payout_changed_at is null then return null; end if;
  if a.payout_verified_at < a.payout_changed_at then return null; end if;
  if a.payout_changed_at > now() - interval '7 days' then return null; end if;
  if exists (select 1 from wa_affiliate_payouts where affiliate_id = p_affiliate and status in ('awaiting_approval','approved','processing')) then return null; end if;

  with cand as (
    select id, commission_cents,
           sum(commission_cents) over (order by coalesce(payable_at, created_at + p_hold), id) as running
    from wa_affiliate_commissions
    where affiliate_id = p_affiliate and status = 'pending' and kind = 'earning'
      and not flagged and payout_id is null and commission_cents > 0
      and coalesce(payable_at, created_at + p_hold) <= now()
  )
  select array_agg(id), coalesce(sum(commission_cents), 0) into v_earn_ids, v_earn from cand where running <= p_max_cents;
  if v_earn_ids is null or v_earn <= 0 then return null; end if;

  select array_agg(id), coalesce(sum(commission_cents), 0) into v_claw_ids, v_claw
  from wa_affiliate_commissions
  where affiliate_id = p_affiliate and status = 'pending' and kind = 'clawback' and payout_id is null;

  v_net := v_earn + v_claw;
  if v_net < p_min_cents or v_net <= 0 or v_net > p_max_cents then return null; end if;

  insert into wa_affiliate_payouts (id, affiliate_id, amount_cents, status, idempotency_key, payout_snapshot)
  values (v_id, p_affiliate, v_net, 'awaiting_approval', v_id::text,
          jsonb_build_object('kind', a.payout_kind, 'last4', a.payout_last4, 'name', a.payout_name, 'fund_account_id', a.rzpx_fund_account_id));

  update wa_affiliate_commissions set status = 'processing', payout_id = v_id
  where id = any(v_earn_ids || coalesce(v_claw_ids, '{}'::uuid[])) and status = 'pending' and payout_id is null;

  return v_id;
end;
$$;

-- ── release ────────────────────────────────────────────────────────────────
-- Payout failed / rejected / cancelled / reversed: rows go back to pending and
-- are claimable again. Idempotent: returns false when the payout is already in
-- a final released state or is not in a state that allows release.
-- 'paid' payouts can only move to 'reversed' (money came back). p_from, when
-- given, restricts the call to payouts currently in one of those statuses
-- (used so a reject cannot race an approve).
create or replace function release_affiliate_payout(p_payout uuid, p_status text, p_reason text, p_from text[] default null)
returns boolean
language plpgsql
as $$
declare p wa_affiliate_payouts%rowtype;
begin
  if p_status not in ('failed','cancelled','reversed') then raise exception 'invalid release status %', p_status; end if;
  select * into p from wa_affiliate_payouts where id = p_payout for update;
  if not found then return false; end if;
  if p_from is not null and not (p.status = any(p_from)) then return false; end if;
  if p.status in ('failed','cancelled','reversed') then return false; end if;
  if p.status = 'paid' and p_status <> 'reversed' then return false; end if;

  update wa_affiliate_payouts set status = p_status, failure_reason = left(coalesce(p_reason, ''), 500), updated_at = now() where id = p_payout;
  update wa_affiliate_commissions set status = 'pending', payout_id = null, paid_at = null
  where payout_id = p_payout and status in ('processing','paid');
  return true;
end;
$$;

-- ── mark paid ──────────────────────────────────────────────────────────────
-- Idempotent: the first call settles the payout and its rows and returns true;
-- a redelivered webhook returns false and changes nothing.
create or replace function mark_affiliate_payout_paid(p_payout uuid, p_utr text)
returns boolean
language plpgsql
as $$
declare p wa_affiliate_payouts%rowtype;
begin
  select * into p from wa_affiliate_payouts where id = p_payout for update;
  if not found then return false; end if;
  if p.status not in ('approved','processing') then return false; end if;
  update wa_affiliate_payouts set status = 'paid', utr = p_utr, updated_at = now() where id = p_payout;
  update wa_affiliate_commissions set status = 'paid', paid_at = now() where payout_id = p_payout and status = 'processing';
  return true;
end;
$$;

-- These move money state; only the service role should call them.
do $$ begin
  revoke execute on function claim_affiliate_payout(uuid, int, int, interval) from public;
  revoke execute on function release_affiliate_payout(uuid, text, text, text[]) from public;
  revoke execute on function mark_affiliate_payout_paid(uuid, text) from public;
exception when others then null; end $$;
do $$ begin
  revoke execute on function claim_affiliate_payout(uuid, int, int, interval) from anon, authenticated;
  revoke execute on function release_affiliate_payout(uuid, text, text, text[]) from anon, authenticated;
  revoke execute on function mark_affiliate_payout_paid(uuid, text) from anon, authenticated;
exception when others then null; end $$;

-- owner_affiliate_stats: money in a payout that is not yet paid still counts as
-- owed ("pending"), so lifetime = pending + paid keeps adding up. Tenants and
-- commissions are aggregated separately: joining both multiplied every
-- commission by the affiliate's tenant count in the 0107 version.
create or replace function owner_affiliate_stats()
returns table (
  affiliate_id uuid, name text, email text, code text, commission_pct numeric,
  referred_count bigint, converted_count bigint,
  pending_cents bigint, paid_cents bigint, lifetime_cents bigint
) language sql stable as $$
  select
    a.id, a.name, a.email, a.code, a.commission_pct,
    coalesce(t.referred, 0), coalesce(t.converted, 0),
    coalesce(c.pending, 0), coalesce(c.paid, 0), coalesce(c.lifetime, 0)
  from wa_affiliates a
  left join (
    select referred_by_affiliate_id as aid, count(*) as referred, count(*) filter (where payment_status = 'active') as converted
    from tenants where referred_by_affiliate_id is not null group by 1
  ) t on t.aid = a.id
  left join (
    select affiliate_id as aid,
      sum(commission_cents) filter (where status in ('pending','processing')) as pending,
      sum(commission_cents) filter (where status = 'paid') as paid,
      sum(commission_cents) filter (where status <> 'void') as lifetime
    from wa_affiliate_commissions group by 1
  ) c on c.aid = a.id;
$$;

-- One bank/UPI reference can settle one payout only (manual mode records the
-- UTR the owner pastes; RazorpayX supplies it). Stops one transfer being
-- recorded against two payouts.
create unique index if not exists wa_affiliate_payouts_utr_uniq on wa_affiliate_payouts (utr) where utr is not null;
