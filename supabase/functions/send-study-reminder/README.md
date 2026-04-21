# send-study-reminder

Daily study reminder Web Push notifications, sent via VAPID.

## How it works

- `pg_cron` fires every 15 min (`0,15,30,45 * * * *`) and calls this function via `pg_net.http_post`.
- Function reads `quiz_settings` where `notification_enabled = true`, filters users whose `notification_hour:notification_minute` (KST) falls in the current 15-min window.
- For each match: skip if already notified today (`daily_stats.notification_sent_at`), skip if daily goal already met, otherwise build a message and blast to every `push_subscriptions` row.

## Deploy

```bash
# 1. Set VAPID secrets (generate once with `bunx web-push generate-vapid-keys`)
supabase secrets set \
  VAPID_PUBLIC_KEY=<public> \
  VAPID_PRIVATE_KEY=<private> \
  VAPID_SUBJECT=mailto:you@example.com

# 2. Deploy the function
supabase functions deploy send-study-reminder

# 3. Apply migrations (adds push_subscriptions + pg_cron schedule)
supabase db push

# 4. Configure Postgres settings used by the cron job
# (Run in Supabase SQL editor — replace placeholders)
ALTER DATABASE postgres SET app.settings.supabase_url = '<https://xxx.supabase.co>';
ALTER DATABASE postgres SET app.settings.service_role_key = '<service-role-key>';
```

## Manual test

```bash
supabase functions invoke send-study-reminder
```

Expected response:
```json
{ "window": { "hour": 21, "minute": 0, "date": "2026-04-20" }, "matched": 3, "sent": 4, "skipped": 0, "errors": 0 }
```

## Rollback

```sql
SELECT cron.unschedule('study-reminder');
```
