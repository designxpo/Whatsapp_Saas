-- Deploy this additive migration before the application update. Old RPCs remain
-- available for compatibility, but old application instances must be drained
-- before the replay fix is effective everywhere. No data changes are required.
-- Rollback: keep these RPCs when reverting application code. Removing them while
-- this application runs makes OTP verification fail closed.

-- A versioned claim keeps the hash comparison constant-time in the application
-- and includes the issuance timestamp so a resend cannot be consumed by a stale
-- verifier, even if the replacement randomly uses the same four digits.
create or replace function email_otp_claim_attempt_v2(
  p_email text, p_purpose text, p_max int, p_now timestamptz
) returns table(ok boolean, out_hash text, out_sent_at timestamptz, reason text)
language plpgsql as $$
declare
  r email_otps%rowtype;
begin
  select * into r from email_otps where email = p_email and purpose = p_purpose for update;
  if not found or r.code_hash = '' then
    ok := false; out_hash := ''; out_sent_at := null; reason := 'no_active_code'; return next; return;
  end if;
  if r.expires_at <= p_now then
    ok := false; out_hash := ''; out_sent_at := null; reason := 'expired'; return next; return;
  end if;
  if r.attempts >= p_max then
    ok := false; out_hash := ''; out_sent_at := null; reason := 'too_many_attempts'; return next; return;
  end if;
  update email_otps set attempts = r.attempts + 1 where email = p_email and purpose = p_purpose;
  ok := true; out_hash := r.code_hash; out_sent_at := r.last_sent_at; reason := 'claimed'; return next;
end;
$$;

-- UPDATE locks the row and rechecks its predicate after a concurrent mutation.
-- Exactly one caller can clear a matching issuance. A replacement, expiry or
-- previous consume returns false rather than authorizing a stale verification.
create or replace function email_otp_consume_if_matches(
  p_email text, p_purpose text, p_hash text, p_sent_at timestamptz, p_now timestamptz
) returns boolean
language plpgsql as $$
declare
  consumed boolean;
begin
  update email_otps set code_hash = ''
  where email = p_email and purpose = p_purpose
    and code_hash <> '' and code_hash = p_hash
    and last_sent_at = p_sent_at and expires_at > p_now
  returning true into consumed;
  return coalesce(consumed, false);
end;
$$;

revoke all on function email_otp_claim_attempt_v2(text, text, int, timestamptz) from public, anon, authenticated;
revoke all on function email_otp_consume_if_matches(text, text, text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function email_otp_claim_attempt_v2(text, text, int, timestamptz) to service_role;
grant execute on function email_otp_consume_if_matches(text, text, text, timestamptz, timestamptz) to service_role;
