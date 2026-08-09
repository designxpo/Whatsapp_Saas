-- 0102_trial_hide_youtube_reviews.sql — YouTube + Google Reviews are paid-plan
-- channels; trial tenants should not see them.
--
-- The admin nav auto-hides any tab whose feature is off (entitlement-registry.ts
-- TAB_FEATURE maps youtube→ch_youtube and reviews→reviews; tabAllowed() filters
-- the sidebar), and the server guards read the same flags. Migration 0096 turned
-- both ON for the trial plan; this narrows the trial tier so they're OFF.
--
-- Requires entitlement enforcement to be ON for the effect to show (tabAllowed
-- returns everything when the enforce_entitlements kill-switch is off).
update wa_plans
  set features = features || '{"ch_youtube":false,"reviews":false}'::jsonb
  where key = 'trial';
