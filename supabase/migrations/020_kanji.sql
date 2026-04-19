-- Kanji reference data: one row per CJK character, with normalized per-reading details.

CREATE TABLE IF NOT EXISTS kanjis (
  character text PRIMARY KEY,
  stroke_count smallint,
  jlpt_level smallint,
  grade smallint,
  frequency integer,
  source text NOT NULL DEFAULT 'kanjidic2',
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'kanji_reading_type') THEN
    CREATE TYPE kanji_reading_type AS ENUM ('on', 'kun');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS kanji_readings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  character text NOT NULL REFERENCES kanjis(character) ON DELETE CASCADE,
  reading text NOT NULL,
  reading_type kanji_reading_type NOT NULL,
  meanings text[] NOT NULL DEFAULT '{}',
  meanings_ko text[] NOT NULL DEFAULT '{}',
  position smallint NOT NULL DEFAULT 0,
  UNIQUE(character, reading, reading_type)
);

CREATE INDEX IF NOT EXISTS idx_kanji_readings_character
  ON kanji_readings(character);

ALTER TABLE kanjis ENABLE ROW LEVEL SECURITY;
ALTER TABLE kanji_readings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'kanjis' AND policyname = 'Anyone can read kanjis'
  ) THEN
    CREATE POLICY "Anyone can read kanjis"
      ON kanjis FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'kanji_readings' AND policyname = 'Anyone can read kanji readings'
  ) THEN
    CREATE POLICY "Anyone can read kanji readings"
      ON kanji_readings FOR SELECT USING (true);
  END IF;
END $$;
