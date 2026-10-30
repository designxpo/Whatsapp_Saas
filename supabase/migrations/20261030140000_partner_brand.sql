-- White-label, Phase 2: what a partner's portal shows instead of Talko.
--
-- One json object per partner: displayName, logoUrl, color, tagline,
-- supportEmail, termsUrl, privacyUrl. Every key is optional; anything missing
-- falls back to the partner's name and contact email (src/lib/whitelabel.ts).
-- Apply after 20261030120000_white_label_partners.sql.

alter table wa_partners add column if not exists brand jsonb not null default '{}'::jsonb;
