-- White-label, Phase 5: a partner's own Meta app, so its customers see the
-- partner's name on Facebook and Instagram permission screens.
--
-- meta_app: { appId, appSecretEnc, igAppId, igAppSecretEnc, fbConfigId,
--   verifyToken, active, status, problems, checkedAt }. Secrets are encrypted
-- (crypto.ts) and never returned by any API. `active` decides whether the
-- partner's customers connect through this app or through Talko's; turning it
-- off moves new connections back to Talko's app in one step.
--
-- The partner's app delivers its webhooks to Talko's usual endpoints with
-- ?app=<partner id>, verified with this app's secret; events without that
-- marker are verified exactly as before.
--
-- Apply after 20261030200000_partner_domains.sql.

alter table wa_partners add column if not exists meta_app jsonb not null default '{}'::jsonb;
