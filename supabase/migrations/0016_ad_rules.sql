-- ── Automated ad rules ────────────────────────────────────────────────────────
-- Portal-defined guardians evaluated by the cron against live campaign insights
-- AND our own CTWA lead attribution (which Meta's native rules can't see).
-- e.g. "pause any campaign whose spend today exceeds 1000 with 0 leads".

create table if not exists wa_ad_rules (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  active            boolean not null default true,
  scope_campaign_id text,                          -- null = all campaigns
  metric            text not null check (metric in ('spend','cpc','ctr','clicks','conversations','leads','cost_per_lead')),
  op                text not null default 'gt' check (op in ('gt','lt')),
  threshold         numeric not null,
  window_preset     text not null default 'today' check (window_preset in ('today','last_7d','last_30d')),
  action            text not null default 'pause' check (action in ('pause','notify')),
  last_checked_at   timestamptz,
  last_triggered_at timestamptz,
  last_result       text,
  created_at        timestamptz not null default now()
);
