-- Gate the two new features per plan, and realign DB prices with the published
-- pricing page.
--
-- Packaging (deliberate split): YouTube comment automation is cheap to run
-- (quota-capped) so every BUSINESS plan gets it; Google review replies are the
-- higher-value feature (standalone tools charge ~$300/mo/location) so they stay
-- Growth-and-above. Creator keeps neither — YouTube is the upsell to Creator Pro.
--
-- Uses jsonb `||` so existing feature keys are preserved, never rewritten.
-- Safe to re-run. NOTE: the resolver in entitlements.ts is fail-open
-- (override ?? planDefault ?? true), so before this migration is applied both
-- features simply show for everyone rather than disappearing.

update wa_plans set features = features || '{"ch_youtube":true,"reviews":true}'::jsonb
  where key in ('trial', 'growth', 'scale', 'creator-pro');

update wa_plans set features = features || '{"ch_youtube":true,"reviews":false}'::jsonb
  where key = 'starter';

update wa_plans set features = features || '{"ch_youtube":false,"reviews":false}'::jsonb
  where key = 'creator';

-- Price realignment (paise) to match the pricing page: Growth ₹5999,
-- Creator Pro ₹2999. Everything else is unchanged.
update wa_plans set price_cents = 599900 where key = 'growth'      and price_cents <> 599900;
update wa_plans set price_cents = 299900 where key = 'creator-pro' and price_cents <> 299900;
