-- 021_web_push_notifications.sql
-- Web push notifications: restore per-user notification settings, add
-- PWA push subscription table, and de-dup column for daily sends.

-- A. quiz_settings: restore notification fields (removed in 020)
ALTER TABLE quiz_settings
  ADD COLUMN IF NOT EXISTS notification_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS notification_hour smallint NOT NULL DEFAULT 21,
  ADD COLUMN IF NOT EXISTS notification_minute smallint NOT NULL DEFAULT 0;

-- B. push_subscriptions: browser PushManager subscriptions
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions(user_id);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own subscriptions"
  ON push_subscriptions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own subscriptions"
  ON push_subscriptions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own subscriptions"
  ON push_subscriptions FOR DELETE USING (auth.uid() = user_id);

-- C. daily_stats: track notification dispatch to avoid duplicate sends on same day
ALTER TABLE daily_stats
  ADD COLUMN IF NOT EXISTS notification_sent_at timestamptz;
