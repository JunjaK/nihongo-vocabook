-- 014_quiz_improvements.sql
-- Quiz system improvements: direction control, session size, leech detection,
-- granular accuracy tracking, example sentences table.

-- A. quiz_settings: direction, session size, leech threshold
ALTER TABLE quiz_settings
  ADD COLUMN IF NOT EXISTS card_direction text NOT NULL DEFAULT 'term_first',
  ADD COLUMN IF NOT EXISTS session_size integer NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS leech_threshold integer NOT NULL DEFAULT 8;

-- B. daily_stats: granular accuracy (split again_count by card type, practice tracking)
ALTER TABLE daily_stats
  ADD COLUMN IF NOT EXISTS review_again_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS new_again_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS practice_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS practice_known_count integer NOT NULL DEFAULT 0;

-- C. user_word_state: leech tracking
ALTER TABLE user_word_state
  ADD COLUMN IF NOT EXISTS is_leech boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS leech_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_uws_leech
  ON user_word_state(user_id, is_leech) WHERE is_leech = true;

-- D. word_examples: example sentences (empty table, populated later)
CREATE TABLE IF NOT EXISTS word_examples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  word_id uuid NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  sentence_ja text NOT NULL,
  sentence_reading text,
  sentence_meaning text,
  source text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_word_examples_word
  ON word_examples(word_id);

ALTER TABLE word_examples ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read examples for own words"
  ON word_examples FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM words WHERE words.id = word_examples.word_id
      AND words.user_id = auth.uid()
  ));

CREATE POLICY "Users can insert examples for own words"
  ON word_examples FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM words WHERE words.id = word_examples.word_id
      AND words.user_id = auth.uid()
  ));

CREATE POLICY "Users can update examples for own words"
  ON word_examples FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM words WHERE words.id = word_examples.word_id
      AND words.user_id = auth.uid()
  ));

CREATE POLICY "Users can delete examples for own words"
  ON word_examples FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM words WHERE words.id = word_examples.word_id
      AND words.user_id = auth.uid()
  ));

-- E. Update v_words_active view to include leech fields
CREATE OR REPLACE VIEW v_words_active WITH (security_invoker = true) AS
SELECT
  w.id,
  w.user_id,
  w.term,
  w.reading,
  w.meaning,
  w.notes,
  w.tags,
  w.jlpt_level,
  w.created_at,
  w.updated_at,
  COALESCE(uws.priority, 2)::smallint AS priority,
  COALESCE(uws.mastered, false) AS mastered,
  uws.mastered_at,
  COALESCE(uws.is_leech, false) AS is_leech,
  uws.leech_at
FROM words w
LEFT JOIN user_word_state uws
  ON uws.word_id = w.id
  AND uws.user_id = auth.uid()
WHERE uws.mastered IS NOT TRUE;
