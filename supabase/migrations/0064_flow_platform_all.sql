-- Let a chatbot flow target the website web-chat widget ('webchat') and ALL
-- channel kinds at once ('all' = WhatsApp + Instagram + Facebook + web chat),
-- alongside the existing whatsapp / instagram / messenger / both (= WA+IG).
alter table wa_flows drop constraint if exists wa_flows_platform_check;
alter table wa_flows add constraint wa_flows_platform_check
  check (platform in ('whatsapp','instagram','messenger','webchat','both','all'));
