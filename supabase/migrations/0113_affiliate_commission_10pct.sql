-- 0113_affiliate_commission_10pct.sql — drop the affiliate commission rate
-- from 20% to 10%.
--
-- Two things, deliberately separate:
--   1. New default for every affiliate signed up from now on.
--   2. A one-time correction of the affiliates who already exist — all five
--      signed up between 2026-08-24 and 2026-08-28 at the old 20% default,
--      none has earned a commission yet (wa_affiliate_commissions is empty
--      for all of them), and the decision was to move them to 10% too rather
--      than grandfather them.
--
-- wa_affiliate_commissions is untouched: each row already has its own
-- commission_pct stamped at the time it was earned (see 0107_affiliates.sql),
-- so a rate change here can never retroactively alter a commission already on
-- the ledger even if one existed.

alter table wa_affiliates alter column commission_pct set default 10.00;

update wa_affiliates set commission_pct = 10.00 where commission_pct = 20.00;
