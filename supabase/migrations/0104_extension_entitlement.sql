-- 0104_extension_entitlement.sql — gate the Talko Copilot browser extension's
-- connect step and its Inbox side-panel / AI-draft routes (whoami, /api/inbox/*,
-- /api/assist/*) to Creator Pro and above. Creator and Starter are priced for a
-- single-channel setup and don't include it.
--
-- Deliberately NOT gated: /api/contacts, /api/events and /api/broadcast, which
-- the extension's basic capture (Grab selection / Scan page) also uses — those
-- routes are shared with the general Developer API and the website OTP-login
-- integration, neither of which has anything to do with owning the extension.
--
-- Uses jsonb `||` so existing feature keys are preserved, never rewritten.
-- Safe to re-run. Fail-open resolver + enforce_entitlements kill-switch: until
-- enforcement is turned on, this has no visible effect, same as every other
-- gated feature today.

update wa_plans set features = features || '{"extension":true}'::jsonb
  where key in ('trial', 'creator-pro', 'growth', 'scale');

update wa_plans set features = features || '{"extension":false}'::jsonb
  where key in ('creator', 'starter');
