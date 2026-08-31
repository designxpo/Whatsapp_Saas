-- 0116_pg_cron_heartbeat.sql — make the background engine's schedule reliable.
--
-- THE PROBLEM: the engine is driven by a GitHub Actions "*/5 * * * *" job, and
-- GitHub's schedule trigger is explicitly best-effort. Their docs: the schedule
-- event "can be delayed during periods of high loads of GitHub Actions workflow
-- runs… if the load is sufficiently high enough, some queued jobs may be
-- dropped", and "high load times include the start of every hour" — which is
-- exactly when a */5 job fires. Observed on this repo: gaps of 3-6 HOURS
-- between runs, for days, with every run that did fire succeeding. Nothing was
-- broken; the clock simply wasn't ticking.
--
-- THE FIX: schedule from inside the database this app already depends on.
-- pg_cron runs in Postgres, so it is up whenever Supabase is up — no third
-- party, no plan-tier cron limits, no GitHub queue to be starved by.
--
-- Layer 2 is the GitHub job, kept as-is: free, sometimes works, and harmless
-- because all cron work is idempotent (atomic claims everywhere).
-- Layer 3 is cronwatchdog.ts, which lets real traffic restart a stalled engine.
--
-- ── HOW TO APPLY ────────────────────────────────────────────────────────────
-- Paste this into the Supabase SQL editor, but FIRST replace the two
-- placeholders below. The secret is deliberately NOT committed to this file:
--
--   <<<CRON_SECRET>>>  — the same value as the app's CRON_SECRET env var
--   <<<APP_URL>>>      — https://app.thetalko.in   (no trailing slash)
--
-- To verify afterwards:      select * from cron.job;
-- To see recent runs:        select * from cron.job_run_details order by start_time desc limit 20;
-- To change the schedule:    re-run the cron.schedule() call — same job name, it replaces.
-- To remove it:              select cron.unschedule('talko-process-queue');

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- net.http_post is async: it queues the request and returns an id immediately,
-- so this job finishes in milliseconds and never holds a worker for the ~50s
-- the engine takes to drain. Fire-and-forget is correct here — the engine
-- records its own heartbeat, which is what the status page reads.
select cron.schedule(
  'talko-process-queue',
  '*/5 * * * *',
  $$
  select net.http_post(
    url     := '<<<APP_URL>>>/api/cron/process-queue',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer <<<CRON_SECRET>>>'
               ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);
