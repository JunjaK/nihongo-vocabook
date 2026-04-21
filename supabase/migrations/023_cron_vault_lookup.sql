-- 023_cron_vault_lookup.sql
-- Reschedule study-reminder cron to read service_role_key from Supabase Vault
-- instead of app.settings (which requires ALTER DATABASE privileges Supabase
-- doesn't grant to project admins).
--
-- Before running this migration, create the vault secret via Dashboard SQL editor:
--   SELECT vault.create_secret('<service-role-key>', 'study_reminder_service_key');

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
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret FROM vault.decrypted_secrets
        WHERE name = 'study_reminder_service_key'
        LIMIT 1
      )
    ),
    body := jsonb_build_object()
  ) AS request_id;
  $$
);
