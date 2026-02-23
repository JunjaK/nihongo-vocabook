-- Per-user word state (mastered, priority) extracted from words table
-- Enables subscribers to track mastery/priority independently from word owners

CREATE TABLE user_word_state (
  user_id     uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  word_id     uuid REFERENCES words(id) ON DELETE CASCADE NOT NULL,
  mastered    boolean NOT NULL DEFAULT false,
  mastered_at timestamptz,
  priority    smallint NOT NULL DEFAULT 2,
  PRIMARY KEY (user_id, word_id)
);

CREATE INDEX idx_uws_word ON user_word_state(word_id);
CREATE INDEX idx_uws_mastered ON user_word_state(user_id, mastered);

ALTER TABLE user_word_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own word state"
  ON user_word_state FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- RPC for wordbook mastered count (works for both owned + subscribed)
CREATE OR REPLACE FUNCTION get_wordbook_mastered_count(wb_id uuid)
RETURNS integer LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT COUNT(*)::integer FROM wordbook_items wi
  JOIN user_word_state uws ON uws.word_id = wi.word_id AND uws.user_id = auth.uid()
  WHERE wi.wordbook_id = wb_id AND uws.mastered = true;
$$;

-- Backfill existing data (best-effort)
INSERT INTO user_word_state (user_id, word_id, mastered, mastered_at, priority)
SELECT user_id, id, mastered, mastered_at, COALESCE(priority, 2) FROM words
ON CONFLICT DO NOTHING;

-- Drop columns from words (now in user_word_state)
ALTER TABLE words DROP COLUMN IF EXISTS mastered;
ALTER TABLE words DROP COLUMN IF EXISTS mastered_at;
ALTER TABLE words DROP COLUMN IF EXISTS priority;
