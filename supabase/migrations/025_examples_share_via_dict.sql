-- 025_examples_share_via_dict.sql
-- Move word_examples from per-user `words` to shared `dictionary_entries`.
-- Force `words` rows to reference a dictionary_entries row (term becomes canonical).
-- See _docs/word-examples-dict-link.md

BEGIN;

-- ==============================================================
-- A. Schema additions (nullable during backfill)
-- ==============================================================

ALTER TABLE words
  ADD COLUMN IF NOT EXISTS dictionary_entry_id uuid REFERENCES dictionary_entries(id);

ALTER TABLE word_examples
  ADD COLUMN IF NOT EXISTS dictionary_entry_id uuid REFERENCES dictionary_entries(id) ON DELETE CASCADE;

-- ==============================================================
-- B. Backfill
-- ==============================================================

-- B.1 Upsert dict from "normal" orphan words (JP-only term/reading, sane length).
-- Character ranges mirror apps/web/scripts/audit-word-dict-link.ts classify():
--   CJK Ext A (U+3400..4DBF), CJK Unified (U+4E00..9FFF),
--   Hiragana (U+3041..309F), Katakana (U+30A0..30FF),
--   plus ー 々 〆 〤 iteration/ideograph markers.
INSERT INTO dictionary_entries (term, reading, meanings, source)
SELECT DISTINCT w.term, w.reading, ARRAY[w.meaning], 'migrated'
FROM words w
LEFT JOIN dictionary_entries d0 ON d0.term = w.term AND d0.reading = w.reading
WHERE d0.id IS NULL
  AND char_length(w.term) BETWEEN 1 AND 20
  AND char_length(w.reading) <= 30
  AND w.term    ~ '^[㐀-䶿一-鿿぀-ゟ゠-ヿーー々〆〤]+$'
  AND w.reading ~ '^[぀-ゟ゠-ヿーー]*$'
ON CONFLICT (term, reading) DO NOTHING;

-- B.2 Fill empty dict meanings from any linked word (no-op if none, audit reported 0).
UPDATE dictionary_entries d
SET meanings = ARRAY[w.meaning]
FROM words w
WHERE d.term = w.term
  AND d.reading = w.reading
  AND cardinality(d.meanings) = 0
  AND char_length(trim(coalesce(w.meaning, ''))) > 0;

-- B.3 Link words → dict by (term, reading).
UPDATE words w
SET dictionary_entry_id = d.id
FROM dictionary_entries d
WHERE d.term = w.term AND d.reading = w.reading;

-- B.4 Abort if any garbage remains (audit reported 0; this is a safety net).
--     Anything still NULL is neither "normal JP" nor previously in dict — bail out.
DO $$
DECLARE
  unlinked_count integer;
BEGIN
  SELECT COUNT(*) INTO unlinked_count FROM words WHERE dictionary_entry_id IS NULL;
  IF unlinked_count > 0 THEN
    RAISE EXCEPTION
      'Aborting: % words still have NULL dictionary_entry_id. Run audit script and resolve.',
      unlinked_count;
  END IF;
END $$;

-- B.5 Link word_examples → dict via the now-populated words.dictionary_entry_id.
UPDATE word_examples we
SET dictionary_entry_id = w.dictionary_entry_id
FROM words w
WHERE we.word_id = w.id;

-- B.6 Drop any still-null examples (audit reported 0 — safety net).
DELETE FROM word_examples WHERE dictionary_entry_id IS NULL;

-- B.7 Dedupe examples on (dictionary_entry_id, sentence_ja) keeping oldest.
DELETE FROM word_examples a
USING word_examples b
WHERE a.dictionary_entry_id = b.dictionary_entry_id
  AND a.sentence_ja = b.sentence_ja
  AND a.created_at > b.created_at;

-- ==============================================================
-- C. Finalize — NOT NULL, drop old column, unique constraints
-- ==============================================================

ALTER TABLE words
  ALTER COLUMN dictionary_entry_id SET NOT NULL;

ALTER TABLE word_examples
  ALTER COLUMN dictionary_entry_id SET NOT NULL;

ALTER TABLE word_examples
  DROP COLUMN word_id;

DROP INDEX IF EXISTS idx_word_examples_word;
CREATE INDEX IF NOT EXISTS idx_word_examples_dict
  ON word_examples(dictionary_entry_id);

CREATE UNIQUE INDEX IF NOT EXISTS word_examples_dict_sentence_uk
  ON word_examples(dictionary_entry_id, sentence_ja);

CREATE UNIQUE INDEX IF NOT EXISTS words_user_dict_uk
  ON words(user_id, dictionary_entry_id);

CREATE INDEX IF NOT EXISTS idx_words_dict
  ON words(dictionary_entry_id);

-- ==============================================================
-- D. RLS flip on word_examples: shared resource (public read, auth write)
-- ==============================================================

DROP POLICY IF EXISTS "Users can read examples for own words"   ON word_examples;
DROP POLICY IF EXISTS "Users can insert examples for own words" ON word_examples;
DROP POLICY IF EXISTS "Users can update examples for own words" ON word_examples;
DROP POLICY IF EXISTS "Users can delete examples for own words" ON word_examples;

CREATE POLICY "Anyone can read word examples"
  ON word_examples FOR SELECT
  USING (true);

CREATE POLICY "Authenticated can insert word examples"
  ON word_examples FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated can update word examples"
  ON word_examples FOR UPDATE
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated can delete word examples"
  ON word_examples FOR DELETE
  TO authenticated
  USING (true);

-- ==============================================================
-- E. Refresh v_words_active view to expose dictionary_entry_id
-- ==============================================================

CREATE OR REPLACE VIEW v_words_active WITH (security_invoker = true) AS
SELECT
  w.id,
  w.user_id,
  w.dictionary_entry_id,
  w.term,
  w.reading,
  w.meaning,
  w.notes,
  w.tags,
  w.jlpt_level,
  w.created_at,
  w.updated_at,
  COALESCE(uws.priority, 2)::smallint AS priority,
  COALESCE(uws.mastered, false)       AS mastered,
  uws.mastered_at,
  COALESCE(uws.is_leech, false)       AS is_leech,
  uws.leech_at
FROM words w
LEFT JOIN user_word_state uws
  ON uws.word_id = w.id
  AND uws.user_id = auth.uid()
WHERE uws.mastered IS NOT TRUE;

GRANT SELECT ON v_words_active TO authenticated;

COMMIT;
