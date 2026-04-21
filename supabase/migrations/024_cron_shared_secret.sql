-- 024_cron_shared_secret.sql
-- Switch the study-reminder cron from Authorization JWT (which fails with the
-- new sb_secret_* service key format) to a shared secret x-cron-secret header.
--
-- Requires a vault secret named 'study_reminder_cron_secret' to exist. Create
-- once via Dashboard SQL Editor:
--   SELECT vault.create_secret('<random-hex>', 'study_reminder_cron_secret');
-- The same value must also be set as CRON_SECRET in Edge Function secrets:
--   supabase secrets set CRON_SECRET=<random-hex>

SELECT cron.unschedule('study-reminder')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'study-reminder');

SELECT cron.schedule(
  'study-reminder',
  '0,15,30,45 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://vsihqvppxzctslsnzrqu.supabase.co/functions/v1/send-study-reminder',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (
        SELECT decrypted_secret FROM vault.decrypted_secrets
        WHERE name = 'study_reminder_cron_secret'
        LIMIT 1
      )
    ),
    body := jsonb_build_object()
  ) AS request_id;
  $$
);
