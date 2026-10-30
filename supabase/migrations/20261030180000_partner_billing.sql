-- White-label, Phase 4: money.
--
-- 1. Partners pay Talko from a PREPAID BALANCE. They add money through a
--    Razorpay payment link on Talko's account; every charge is taken from the
--    balance, so a partner can never owe Talko anything. The deposit stays in
--    the balance but can't be spent (available = balance - deposit).
--    Every movement of money goes through partner_ledger_post(), which locks
--    the partner row, refuses duplicates, and writes the balance and the ledger
--    line together.
-- 2. Partners bill their own customers through their OWN Razorpay account
--    (keys stored encrypted), by monthly payment links. A paid link marks the
--    workspace paid for that month.
--
-- Apply after 20261030160000_partner_dashboard.sql.

alter table wa_partners
  add column if not exists balance_cents bigint not null default 0,
  add column if not exists billing_day int not null default 1 check (billing_day between 1 and 28),
  add column if not exists billing_state text not null default 'ok' check (billing_state in ('ok', 'grace', 'suspended')),
  add column if not exists grace_until timestamptz,
  add column if not exists setup_paid_at timestamptz,
  -- Partner's own Razorpay: { keyId, secretEnc, webhookSecretEnc }, secrets encrypted (crypto.ts).
  add column if not exists razorpay jsonb not null default '{}'::jsonb,
  -- How the partner bills its customers: { autoLinks: bool, graceDays: int, autoPause: bool }.
  add column if not exists customer_billing jsonb not null default '{}'::jsonb;

-- Why a partner workspace is paused: 'partner' (by the partner), 'billing'
-- (the partner's balance ran out), 'unpaid' (its customer didn't pay the
-- partner), 'talko' (Talko paused the whole partner). Resuming only ever lifts
-- the pause its own cause put on.
alter table tenants add column if not exists partner_pause text check (partner_pause in ('partner', 'billing', 'unpaid', 'talko'));

create table if not exists wa_partner_ledger (
  id bigint generated always as identity primary key,
  partner_id uuid not null references wa_partners(id) on delete cascade,
  kind text not null check (kind in ('topup', 'setup', 'monthly', 'prorata', 'adjust', 'refund')),
  amount_cents bigint not null,               -- + adds to the balance, - takes from it
  balance_after_cents bigint not null,
  description text not null default '',
  period text,                                 -- 'YYYY-MM' for monthly and prorata lines
  ref text,                                    -- payment link id, or a de-duplication key
  tenant_id uuid references tenants(id) on delete set null,
  actor text,
  created_at timestamptz not null default now()
);
create unique index if not exists wa_partner_ledger_ref_uq on wa_partner_ledger (partner_id, ref) where ref is not null;
create index if not exists wa_partner_ledger_partner_idx on wa_partner_ledger (partner_id, created_at desc);

-- Payment links a partner sends its own customers, and whether they were paid.
create table if not exists wa_partner_invoices (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references wa_partners(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  period text not null,
  amount_cents bigint not null check (amount_cents > 0),
  status text not null default 'sent' check (status in ('sent', 'paid', 'cancelled')),
  link_id text,
  link_url text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, period)
);
create index if not exists wa_partner_invoices_partner_idx on wa_partner_invoices (partner_id, period desc);

alter table wa_partner_ledger enable row level security;
alter table wa_partner_invoices enable row level security;

-- One movement of money, atomically. A debit that would take the AVAILABLE
-- balance (balance minus deposit) below zero is refused unless p_allow_short.
-- A repeated ref is a no-op that returns the existing line (exactly once).
create or replace function partner_ledger_post(
  p_partner uuid, p_kind text, p_amount bigint, p_description text,
  p_period text default null, p_ref text default null, p_tenant uuid default null,
  p_actor text default null, p_allow_short boolean default false
) returns table (ok boolean, balance_cents bigint, duplicate boolean, short boolean)
language plpgsql security definer set search_path = public as $$
declare
  v_balance bigint;
  v_deposit bigint;
  v_existing bigint;
begin
  select w.balance_cents, w.deposit_cents into v_balance, v_deposit from wa_partners w where w.id = p_partner for update;
  if not found then
    raise exception 'partner % not found', p_partner;
  end if;
  if p_ref is not null then
    select l.balance_after_cents into v_existing from wa_partner_ledger l where l.partner_id = p_partner and l.ref = p_ref;
    if found then
      return query select true, v_balance, true, false;
      return;
    end if;
  end if;
  if p_amount < 0 and not p_allow_short and v_balance + p_amount < coalesce(v_deposit, 0) then
    return query select false, v_balance, false, true;
    return;
  end if;
  update wa_partners set balance_cents = v_balance + p_amount, updated_at = now() where id = p_partner;
  insert into wa_partner_ledger (partner_id, kind, amount_cents, balance_after_cents, description, period, ref, tenant_id, actor)
    values (p_partner, p_kind, p_amount, v_balance + p_amount, coalesce(p_description, ''), p_period, p_ref, p_tenant, p_actor);
  return query select true, v_balance + p_amount, false, false;
end $$;

revoke all on function partner_ledger_post(uuid, text, bigint, text, text, text, uuid, text, boolean) from public, anon, authenticated;
