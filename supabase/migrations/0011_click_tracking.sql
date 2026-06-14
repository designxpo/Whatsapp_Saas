-- ── Click tracking for template URL buttons ──────────────────────────────────
-- Tracked short links: each recipient × tracked button gets a unique code.
-- /r/<code> logs the click and 302-redirects to the target URL.
create table if not exists wa_links (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique,
  campaign_id      uuid references wa_campaigns(id) on delete cascade,
  phone            text not null default '',
  target_url       text not null,
  button_index     int not null default 0,
  clicks           int not null default 0,
  first_clicked_at timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists wal_campaign_idx on wa_links (campaign_id);
create index if not exists wal_clicked_idx on wa_links (campaign_id) where first_clicked_at is not null;

-- Per-template click-tracking config: which URL buttons were wrapped and what
-- they originally pointed at. Written when a template is submitted with
-- "Enable click tracking"; read by sendCampaign to mint per-recipient codes.
create table if not exists wa_template_meta (
  template_name  text primary key,
  click_tracking boolean not null default false,
  tracked_urls   jsonb not null default '[]'::jsonb,   -- [{ "index": 0, "url": "https://…" }]
  updated_at     timestamptz not null default now()
);

-- Atomic click increment (also stamps first click time).
create or replace function wa_register_click(p_code text)
returns text language plpgsql as $$
declare v_target text;
begin
  update wa_links
     set clicks = clicks + 1,
         first_clicked_at = coalesce(first_clicked_at, now())
   where code = p_code
   returning target_url into v_target;
  return v_target;  -- null when the code doesn't exist
end $$;
