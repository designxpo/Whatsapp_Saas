-- Let a chatbot flow target Facebook Messenger (channel kind 'messenger'),
-- alongside whatsapp / instagram / both.
alter table wa_flows drop constraint if exists wa_flows_platform_check;
alter table wa_flows add constraint wa_flows_platform_check check (platform in ('whatsapp','instagram','messenger','both'));
