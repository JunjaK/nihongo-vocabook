-- 022_cron_study_reminder.sql
-- Schedule the send-study-reminder Edge Function to run every 15 minutes.
--
-- Requires pg_cron + pg_net extensions. Enable via Supabase dashboard if not already.
-- Also requires:
--   - app.settings.supabase_url
--   - app.settings.service_role_key
-- set as custom Postgres settings, or use vault-stored secrets.
--
-- If your Supabase project exposes vault_decrypted_secrets, you can look them up:
--   SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key';

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Drop any prior schedule with the same name
SELECT cron.unschedule('study-reminder')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'study-reminder');

-- Schedule: at minutes 0, 15, 30, 45 of every hour
SELECT cron.schedule(
  'study-reminder',
  '0,15,30,45 * * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/send-study-reminder',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := jsonb_build_object()
  ) AS request_id;
  $$
);
