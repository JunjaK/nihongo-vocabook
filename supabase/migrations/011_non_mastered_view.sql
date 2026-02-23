-- View for non-mastered words with effective priority from user_word_state
-- Uses security_invoker so RLS on underlying tables is respected
CREATE VIEW v_words_active WITH (security_invoker = true) AS
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
  uws.mastered_at
FROM words w
LEFT JOIN user_word_state uws
  ON uws.word_id = w.id
  AND uws.user_id = auth.uid()
WHERE uws.mastered IS NOT TRUE;

GRANT SELECT ON v_words_active TO authenticated;
