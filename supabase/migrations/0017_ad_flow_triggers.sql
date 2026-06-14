-- ── Connect a chatbot flow to a Meta Ads campaign or ad ───────────────────────
-- When a Click-to-WhatsApp lead's first message arrives, the webhook looks up
-- the flow bound to that ad (ad-level wins) or its campaign (campaign default),
-- and starts it — instead of waiting for a keyword the lead never types.

create table if not exists wa_ad_flow_triggers (
  id         uuid primary key default gen_random_uuid(),
  flow_id    uuid not null references wa_flows(id) on delete cascade,
  scope      text not null check (scope in ('ad','campaign')),
  ref_id     text not null,                       -- the ad_id or campaign_id
  label      text,                                -- campaign/ad name, for the UI
  created_at timestamptz not null default now(),
  unique (scope, ref_id)                          -- one flow per ad / per campaign
);
create index if not exists wa_ad_flow_triggers_flow on wa_ad_flow_triggers(flow_id);

-- ad_id → campaign_id cache, so the webhook resolves campaign-level triggers
-- without calling Meta on every inbound message.
create table if not exists wa_ad_campaign_map (
  ad_id       text primary key,
  campaign_id text not null,
  fetched_at  timestamptz not null default now()
);
