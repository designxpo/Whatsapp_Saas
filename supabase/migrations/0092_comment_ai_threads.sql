-- AI takeover of comment threads that a rule opened.
-- When a comment rule fires its public reply, we "watch" that thread. If someone
-- then replies in it, the AI answers contextually instead of re-firing the rule.
-- Each row maps a comment id that, WHEN REPLIED TO, should invoke the AI (the
-- original top-level comment id, and our bot reply id) → the thread's context.
-- depth caps how many AI turns a single thread may run (anti-runaway).
create table if not exists wa_comment_threads (
  watch_comment_id text primary key,            -- reply to THIS id → AI answers
  tenant_id uuid not null,
  channel_id uuid,
  platform text not null,                        -- instagram | messenger
  root_comment_id text not null,                 -- where AI posts its reply (top-level)
  original_text text,                            -- the human's original comment (context)
  reply_text text,                               -- our last reply in the thread (context)
  depth int not null default 0,                  -- AI turns so far (cap ~4)
  created_at timestamptz not null default now()
);
create index if not exists idx_wa_comment_threads_tenant on wa_comment_threads (tenant_id, created_at desc);
alter table wa_comment_threads enable row level security;
