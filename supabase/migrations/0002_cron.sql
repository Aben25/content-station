-- Minute tick that drives daily delivery, retention, and offline alerts.
-- After deploy, point it at the api function:
--   alter database postgres set app.settings.api_url = 'https://<ref>.supabase.co/functions/v1/api';
--   alter database postgres set app.settings.cron_secret = '<CRON_SECRET>';
-- Then reconnect so the settings load. The job no-ops until both are set.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid) from cron.job where jobname = 'contentstation-tick';

select cron.schedule(
  'contentstation-tick',
  '* * * * *',
  $$
  select net.http_post(
    url := current_setting('app.settings.api_url', true) || '/internal/cron/tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', coalesce(current_setting('app.settings.cron_secret', true), '')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  )
  where coalesce(current_setting('app.settings.api_url', true), '') <> '';
  $$
);
