-- Add FSRS columns to study_progress
ALTER TABLE study_progress
  ADD COLUMN IF NOT EXISTS stability real NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS difficulty real NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS elapsed_days integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS scheduled_days integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS learning_steps integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lapses integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS card_state integer NOT NULL DEFAULT 0;

-- Backfill: mark existing reviewed cards as Review state (2)
UPDATE study_progress
  SET card_state = 2
  WHERE review_count > 0 AND card_state = 0;

-- Quiz settings table
CREATE TABLE IF NOT EXISTS quiz_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  new_per_day integer NOT NULL DEFAULT 20,
  max_reviews_per_day integer NOT NULL DEFAULT 100,
  jlpt_filter integer,
  priority_filter integer,
  new_card_order text NOT NULL DEFAULT 'recent',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE quiz_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own quiz settings"
  ON quiz_settings FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Daily stats table
CREATE TABLE IF NOT EXISTS daily_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stat_date date NOT NULL,
  new_count integer NOT NULL DEFAULT 0,
  review_count integer NOT NULL DEFAULT 0,
  again_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, stat_date)
);

ALTER TABLE daily_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own daily stats"
  ON daily_stats FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Achievements table
CREATE TABLE IF NOT EXISTS achievements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL,
  unlocked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, type)
);

ALTER TABLE achievements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own achievements"
  ON achievements FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
