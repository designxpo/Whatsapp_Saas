-- Multi-agent routing: a conversation can be pinned to a specific AI agent
-- (set by a flow node or from the inbox). Null -> the globally active agent.
alter table wa_conversations add column if not exists agent_id uuid references wa_ai_agents(id) on delete set null;
