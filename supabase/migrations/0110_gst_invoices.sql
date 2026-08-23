-- 0110_gst_invoices.sql — GST tax-invoice documents on top of the billing
-- breakdown from 0109. Two things were missing before a charge could produce a
-- document that satisfies CGST Rule 46: a consecutive invoice number, and the
-- statutory fields (taxable value, the CGST/SGST-or-IGST split, place of
-- supply, both parties' identity) recorded AT THE TIME of the charge rather
-- than recomputed later from whatever the rate/address happens to be then.
--
-- Numbers are per (series, financial_year) because Rule 46(b) resets the
-- series each Indian FY (1 April – 31 March), and because a tenant may need a
-- separate series later (credit notes, a second legal entity) without
-- disturbing the one already issued to customers.

create table if not exists wa_invoice_counters (
  series text not null,
  financial_year text not null,
  last_number int not null default 0,
  primary key (series, financial_year)
);

-- Allocate the next number in a series. Rule 46(b) requires the series to be
-- BOTH consecutive and unique, so two renewals charged in the same instant must
-- never be handed the same number — and a gap is nearly as bad, since it has to
-- be explained to an auditor.
--
-- The insert-on-conflict-do-update form is the only one that gives us that for
-- free. Postgres takes a row-level lock on the conflicting row before running
-- the DO UPDATE, so a second concurrent call BLOCKS there, then re-reads the
-- row the first call just committed and adds 1 to *that* value. A read-then-
-- write pair (select last_number … update … set last_number = $1 + 1) cannot
-- do this: under READ COMMITTED both transactions read the same value and one
-- silently overwrites the other, issuing a duplicate number. Volatile because
-- it writes; never call it outside the transaction that stamps the invoice.
create or replace function alloc_invoice_number(p_series text, p_fy text)
returns int language sql volatile as $$
  insert into wa_invoice_counters (series, financial_year, last_number)
  values (p_series, p_fy, 1)
  on conflict (series, financial_year) do update
    set last_number = wa_invoice_counters.last_number + 1
  returning last_number;
$$;

-- The statutory face of a charge, alongside the money columns from 0109.
-- taxable_value_cents is the s.15 value of supply (base + the gateway fee we
-- recover from the customer), which is what GST is actually charged on — it is
-- NOT base_amount_cents. The split is stored as three separate columns rather
-- than a total + a kind flag so the document renders straight from the row and
-- can never disagree with itself.
alter table wa_billing_events add column if not exists invoice_number text;
alter table wa_billing_events add column if not exists invoice_issued_at timestamptz;
alter table wa_billing_events add column if not exists taxable_value_cents int;
alter table wa_billing_events add column if not exists cgst_cents int;
alter table wa_billing_events add column if not exists sgst_cents int;
alter table wa_billing_events add column if not exists igst_cents int;
alter table wa_billing_events add column if not exists place_of_supply text;
alter table wa_billing_events add column if not exists payment_method text;
-- 'Tax Invoice' vs 'Payment Receipt' as it was ACTUALLY printed. A charge made
-- before our own GSTIN/SAC were configured was only ever a receipt, and
-- relabelling it retroactively when the env vars land would be a lie.
alter table wa_billing_events add column if not exists document_label text;

-- Partial on purpose. Every charge recorded before this migration, and every
-- future receipt-only charge, has a null invoice_number; keeping those rows out
-- of the index entirely means the uniqueness claim covers issued numbers only
-- and never rests on the server's NULLS DISTINCT default (which PG15 made
-- switchable). The index is what makes a duplicate number impossible even if
-- alloc_invoice_number() were ever bypassed.
create unique index if not exists wa_billing_events_invoice_number_idx
  on wa_billing_events (invoice_number) where invoice_number is not null;

-- ONE ROW PER PAYMENT. Two independent paths record the same Razorpay payment:
-- the checkout confirmation (api/admin/billing/razorpay/verify, which runs from
-- the browser handler) and the subscription.charged webhook. Both fire for a
-- FIRST payment, so until now every first payment wrote two rows for one charge
-- — which double-counted it in the owner Revenue page's net-of-fees figure
-- (gatewayFeesInWindow sums total_charged_cents), had recordActualGatewayFee
-- stamp the real fee onto both, and — once a charge starts producing a numbered
-- document — would hand the same money two different invoice numbers.
--
-- A unique constraint is the only fix that holds: the two writers race by
-- design and neither can see the other's row in time. recordBillingEvent()
-- turns the conflict into "return the row that already exists", so both paths
-- converge on one event and the invoice is issued exactly once per payment.
--
-- Dedupe first, or the index cannot be created on a table that already has
-- duplicates. Keep the OLDEST row per payment (the checkout confirmation, which
-- carries the plan-derived breakdown) and fold nothing from the loser — the
-- money columns are identical by construction, and the webhook re-stamps
-- payment_method and the actual fee onto the survivor anyway.
delete from wa_billing_events a
  using wa_billing_events b
  where a.provider_payment_id is not null
    and a.provider_payment_id = b.provider_payment_id
    and a.invoice_number is null          -- never delete a row a document was issued against
    and (a.created_at > b.created_at or (a.created_at = b.created_at and a.id > b.id));

create unique index if not exists wa_billing_events_payment_unique_idx
  on wa_billing_events (provider_payment_id) where provider_payment_id is not null;

-- Durable send-once marker for the invoice email. claimWebhookEvent() alone is
-- not enough: store.ts's pruneEphemeral() drops dedup rows after 48h, so any
-- webhook redelivery, backfill or support-triggered replay after two days would
-- email a SECOND copy of an already-issued, consecutively-numbered document.
-- A dunning notice can tolerate that; a tax invoice cannot.
alter table wa_billing_events add column if not exists invoice_emailed_at timestamptz;

-- Recipient identity, needed on every B2B invoice (Rule 46(e)-(g)).
-- billing_state_code is stored SEPARATELY from billing_state because the split
-- between IGST and CGST+SGST is decided purely by the 2-digit GST state code
-- (IGST Act s.12), and mapping a free-text state name to that code is
-- unreliable: "Delhi"/"NCT of Delhi"/"New Delhi" are the same code 07, and
-- Telangana (36) vs Andhra Pradesh (37) were the same name for years. Getting
-- it wrong charges the wrong tax head, which is a filing correction, not a
-- cosmetic one — so we capture the code the tenant's own GSTIN starts with
-- instead of deriving it.
alter table tenants add column if not exists gstin text;
alter table tenants add column if not exists billing_legal_name text;
alter table tenants add column if not exists billing_address text;
alter table tenants add column if not exists billing_state text;
alter table tenants add column if not exists billing_state_code text;
alter table tenants add column if not exists billing_country text default 'IN';
