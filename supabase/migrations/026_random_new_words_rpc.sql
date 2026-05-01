-- Migration 026: RPC for random new-word selection
--
-- Without server-side ORDER BY random(), the Supabase REST query for new
-- words returns rows in postgres-default (insertion) order and is then
-- sliced client-side. That biases the new-card pool to the alphabetically
-- first N words and makes the same words recur every session.
--
-- This RPC fetches a true random sample of the user's eligible new words.
-- Eligible = no study_progress row for the user, not mastered, matching
-- optional jlpt/priority filters.
--
-- Reuses the existing `v_words_active` view (security_invoker) which
-- already enforces RLS via auth.uid() and filters out mastered rows.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_random_new_words(
  p_jlpt_filter int DEFAULT NULL,
  p_priority_filter int DEFAULT NULL,
  p_count int DEFAULT 60
)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  term text,
  reading text,
  meaning text,
  notes text,
  tags text[],
  jlpt_level smallint,
  created_at timestamptz,
  updated_at timestamptz,
  priority smallint,
  mastered boolean,
  mastered_at timestamptz,
  is_leech boolean,
  leech_at timestamptz,
  dictionary_entry_id uuid
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    v.id, v.user_id, v.term, v.reading, v.meaning, v.notes,
    v.tags, v.jlpt_level, v.created_at, v.updated_at,
    v.priority, v.mastered, v.mastered_at, v.is_leech, v.leech_at,
    v.dictionary_entry_id
  FROM v_words_active v
  WHERE NOT EXISTS (
    SELECT 1 FROM study_progress sp
    WHERE sp.word_id = v.id
      AND sp.user_id = auth.uid()
  )
    AND (p_jlpt_filter IS NULL OR v.jlpt_level = p_jlpt_filter)
    AND (p_priority_filter IS NULL OR v.priority = p_priority_filter)
  ORDER BY random()
  LIMIT p_count;
$$;

GRANT EXECUTE ON FUNCTION public.get_random_new_words(int, int, int) TO authenticated;

COMMIT;
