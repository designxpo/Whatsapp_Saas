-- Phase 2 "automation visibility": why a drip stopped, when, and who stopped it.
-- Written in a separate best-effort step after each stop (sequences.ts
-- noteStopReason), so stops keep working before this is applied.
alter table wa_sequence_enrollments add column if not exists stop_reason text;
alter table wa_sequence_enrollments add column if not exists stopped_at  timestamptz;
alter table wa_sequence_enrollments add column if not exists stopped_by  text;
create index if not exists wa_seq_enroll_phone_idx on wa_sequence_enrollments (tenant_id, phone, updated_at desc);
