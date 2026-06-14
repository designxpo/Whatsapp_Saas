-- 0021_flow_platform.sql — let a chatbot flow target WhatsApp or Instagram.
alter table wa_flows add column if not exists platform text not null default 'whatsapp'
  check (platform in ('whatsapp','instagram'));
