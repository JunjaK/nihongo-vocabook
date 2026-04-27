-- 020_quiz_redesign.sql
-- Quiz system redesign: daily goal model, example quiz ratio, notification cleanup.

-- A. quiz_settings: add daily_goal + example_quiz_ratio, drop notification + legacy size fields
ALTER TABLE quiz_settings
  ADD COLUMN IF NOT EXISTS daily_goal smallint NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS example_quiz_ratio smallint NOT NULL DEFAULT 30;

-- Backfill daily_goal from legacy session_size (best-effort) before we drop the column
-- Wrapped in DO so re-runs are no-ops once session_size has been dropped.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'quiz_settings' AND column_name = 'session_size'
  ) THEN
    EXECUTE 'UPDATE quiz_settings
      SET daily_goal = GREATEST(10, LEAST(100, COALESCE(session_size, 20)))
      WHERE daily_goal = 20 AND session_size IS NOT NULL';
  END IF;
END $$;

ALTER TABLE quiz_settings
  DROP COLUMN IF EXISTS new_per_day,
  DROP COLUMN IF EXISTS max_reviews_per_day,
  DROP COLUMN IF EXISTS session_size,
  DROP COLUMN IF EXISTS notification_enabled,
  DROP COLUMN IF EXISTS notification_hour,
  DROP COLUMN IF EXISTS notification_minute;

-- B. daily_stats: reset — old reviewCount semantics drift under new rule set
-- (Not destructive: historical rows survive migration; simply reset today forward.)
-- Keep existing rows for streak calculations; no-op.

-- C. push_tokens table is no longer used, but left in place.
-- Dropping would require a separate migration once we confirm no external consumers remain.
