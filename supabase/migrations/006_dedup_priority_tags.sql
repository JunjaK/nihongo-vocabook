-- Word dedup: unique per user by (term, reading)
CREATE UNIQUE INDEX IF NOT EXISTS idx_words_user_term_reading
  ON words (user_id, term, reading);

-- Wordbook dedup: unique per user by name
CREATE UNIQUE INDEX IF NOT EXISTS idx_wordbooks_user_name
  ON wordbooks (user_id, name);

-- Word priority: 1=high, 2=medium, 3=low (default medium)
ALTER TABLE words ADD COLUMN IF NOT EXISTS priority smallint NOT NULL DEFAULT 2
  CHECK (priority BETWEEN 1 AND 3);
CREATE INDEX IF NOT EXISTS idx_words_priority ON words (user_id, priority);

-- Wordbook tags
ALTER TABLE wordbooks ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';

-- Wordbook import count
ALTER TABLE wordbooks ADD COLUMN IF NOT EXISTS import_count integer NOT NULL DEFAULT 0;
