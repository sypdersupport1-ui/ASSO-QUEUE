-- Phase 3A (revised): free scheduling via pg_cron — replaces Vercel cron (costly)
-- Queue maintenance runs as a direct DB call every minute (no HTTP, no extra cost).
-- Notifications still need app-level provider processing, so pg_cron triggers the
-- existing secured HTTP route via pg_net (also free). Both jobs are idempotent:
-- re-running finds nothing new to do.

-- 1. Enable extensions (if Dashboard > Database > Extensions was not used, this is a no-op fallback)
DO $do$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
EXCEPTION WHEN OTHERS THEN NULL;
END $do$;

-- 2. Direct-DB queue maintenance job (free, no HTTP, no secret needed)
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('queue-maintenance-every-minute');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    PERFORM cron.schedule(
      'queue-maintenance-every-minute',
      '* * * * *',
      $job$SELECT public.expire_overdue_called_queue_entries(50)$job$
    );
  END IF;
END $do$;

-- 3. Notification worker via pg_net (manual step — needs YOUR-APP-URL + CRON_SECRET):
--
--    CREATE EXTENSION IF NOT EXISTS pg_net;
--    SELECT cron.schedule(
--      'notifications-every-minute',
--      '* * * * *',
--      $$
--      SELECT net.http_post(
--        url := 'https://YOUR-APP-URL/api/cron/notifications?limit=50',
--        headers := '{"Authorization": "Bearer YOUR-CRON-SECRET", "Content-Type": "application/json"}'::jsonb,
--        body := '{}'::jsonb
--      )
--      $$
--    );
--
--    Inspect jobs:  SELECT jobname, schedule, active FROM cron.job;
--    Remove a job:  SELECT cron.unschedule('queue-maintenance-every-minute');
