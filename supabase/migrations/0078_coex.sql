-- 0078: coexistence flag on channels.
-- coex = this WhatsApp number is ALSO active on the WhatsApp Business phone app
-- (connected via Embedded Signup's QR-scan "whatsapp_business_app_onboarding"
-- flow). Bookkeeping/display only — runtime behavior is driven by the channel
-- mode and the smb_message_echoes webhook, which work regardless of this flag.
alter table wa_channels add column if not exists coex boolean not null default false;
