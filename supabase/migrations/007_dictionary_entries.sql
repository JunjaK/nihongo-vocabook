CREATE TABLE IF NOT EXISTS dictionary_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  term text NOT NULL,
  reading text NOT NULL DEFAULT '',
  meanings text[] NOT NULL DEFAULT '{}',
  parts_of_speech text[] DEFAULT '{}',
  jlpt_level smallint,
  source text NOT NULL DEFAULT 'jisho',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(term, reading)
);

CREATE INDEX IF NOT EXISTS idx_dictionary_entries_term ON dictionary_entries(term);

ALTER TABLE dictionary_entries ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'dictionary_entries' AND policyname = 'Anyone can read dictionary entries'
  ) THEN
    CREATE POLICY "Anyone can read dictionary entries"
      ON dictionary_entries FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'dictionary_entries' AND policyname = 'Anyone can insert dictionary entries'
  ) THEN
    CREATE POLICY "Anyone can insert dictionary entries"
      ON dictionary_entries FOR INSERT WITH CHECK (true);
  END IF;
END $$;
