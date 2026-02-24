-- Batch get mastered counts for multiple wordbooks in a single call
-- Replaces N sequential calls to get_wordbook_mastered_count
CREATE OR REPLACE FUNCTION get_wordbook_mastered_counts(wb_ids uuid[])
RETURNS TABLE(wordbook_id uuid, mastered_count integer)
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT wi.wordbook_id, COUNT(*)::integer
  FROM wordbook_items wi
  JOIN user_word_state uws ON uws.word_id = wi.word_id AND uws.user_id = auth.uid()
  WHERE wi.wordbook_id = ANY(wb_ids) AND uws.mastered = true
  GROUP BY wi.wordbook_id;
$$;

-- Batch get user emails for multiple user IDs in a single call
-- Replaces N sequential calls to get_user_email
CREATE OR REPLACE FUNCTION get_user_emails(uids uuid[])
RETURNS TABLE(uid uuid, email text)
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT id, email FROM auth.users WHERE id = ANY(uids);
$$;

-- Atomic increment for import_count (fixes TOCTOU race condition)
CREATE OR REPLACE FUNCTION increment_import_count(wb_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE wordbooks SET import_count = import_count + 1 WHERE id = wb_id;
$$;
