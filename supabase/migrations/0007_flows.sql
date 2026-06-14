-- Chatbot flow builder: flow definitions + per-conversation execution sessions.

create table if not exists wa_flows (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default false,
  trigger_keywords text[] not null default '{}',   -- inbound message that starts the flow
  graph jsonb not null default '{"nodes":[],"edges":[]}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Where each conversation currently is inside a flow. conversation_id is text
-- (not FK) so the simulator can run sessions without real conversations.
create table if not exists wa_flow_sessions (
  conversation_id text primary key,
  flow_id uuid not null references wa_flows(id) on delete cascade,
  current_node text not null,
  state jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
