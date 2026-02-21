-- Add mastered fields to words
ALTER TABLE words ADD COLUMN mastered boolean NOT NULL DEFAULT false;
ALTER TABLE words ADD COLUMN mastered_at timestamptz;
CREATE INDEX idx_words_mastered ON words(user_id, mastered);

-- Create wordbooks table
CREATE TABLE wordbooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  description text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create wordbook_items table
CREATE TABLE wordbook_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wordbook_id uuid REFERENCES wordbooks(id) ON DELETE CASCADE NOT NULL,
  word_id uuid REFERENCES words(id) ON DELETE CASCADE NOT NULL,
  added_at timestamptz DEFAULT now(),
  UNIQUE (wordbook_id, word_id)
);

-- RLS for wordbooks
ALTER TABLE wordbooks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own wordbooks"
  ON wordbooks FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own wordbooks"
  ON wordbooks FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own wordbooks"
  ON wordbooks FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own wordbooks"
  ON wordbooks FOR DELETE
  USING (auth.uid() = user_id);

-- RLS for wordbook_items
ALTER TABLE wordbook_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own wordbook items"
  ON wordbook_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM wordbooks
      WHERE wordbooks.id = wordbook_items.wordbook_id
      AND wordbooks.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert own wordbook items"
  ON wordbook_items FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM wordbooks
      WHERE wordbooks.id = wordbook_items.wordbook_id
      AND wordbooks.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete own wordbook items"
  ON wordbook_items FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM wordbooks
      WHERE wordbooks.id = wordbook_items.wordbook_id
      AND wordbooks.user_id = auth.uid()
    )
  );

-- Indexes for wordbook_items
CREATE INDEX idx_wordbook_items_wordbook ON wordbook_items(wordbook_id);
CREATE INDEX idx_wordbook_items_word ON wordbook_items(word_id);
