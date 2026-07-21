-- Per-number CRM lead Source. When a NEW lead arrives on a WhatsApp number that
-- has this set, the auto-created LeadSquared lead uses it as the Source (e.g.
-- "ppc-whatsapp") — so leads can be attributed to the specific number/campaign
-- they came in on, instead of the generic "WhatsApp". Null = fall back to
-- "WhatsApp" (or a tracked-link [ref:CODE] source, which takes precedence).
alter table wa_channels add column if not exists crm_source text;
