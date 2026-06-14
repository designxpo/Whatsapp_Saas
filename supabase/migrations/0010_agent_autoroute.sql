-- Auto agent routing: each agent gets a routing embedding (from its
-- description + routing keywords); inbound queries are matched by cosine
-- similarity and the conversation switches to the best-fit agent.
alter table wa_ai_agents add column if not exists routing_keywords text not null default '';
alter table wa_ai_agents add column if not exists embedding jsonb;  -- number[768], few agents -> JS cosine, no index needed
