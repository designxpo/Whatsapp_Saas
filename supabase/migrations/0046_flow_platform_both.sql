-- Let a single chatbot flow target BOTH WhatsApp and Instagram, so the same
-- flow definition runs on either channel instead of being duplicated per platform.
alter table wa_flows drop constraint if exists wa_flows_platform_check;
alter table wa_flows add constraint wa_flows_platform_check check (platform in ('whatsapp','instagram','both'));
