-- AI Hub: configurable agent personas, function-calling lead capture, agent-assist prompts.

-- Agent personas — one active at a time; the AI bot speaks as the active agent.
create table if not exists wa_ai_agents (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  persona text not null default '',          -- generated/edited system persona
  constraints_text text not null default '', -- "You must NOT / You SHOULD"
  product_info text not null default '',     -- extra product & service info
  model text,                                -- optional model override
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Function-calling definitions: Gemini extracts structured data mid-conversation,
-- saves params to contact attributes, optionally fires a webhook / escalates.
create table if not exists wa_ai_functions (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,                 -- snake_case for Gemini tool name
  description text not null default '',
  parameters jsonb not null default '[]',    -- [{name, description, required, saveToAttribute}]
  webhook_url text,                          -- optional: POST collected data here
  escalate boolean not null default false,   -- calling this hands off to a human
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Agent-assist prompts for the team inbox composer (tone, translate, fix, etc).
create table if not exists wa_ai_prompts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  prompt text not null,
  active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
