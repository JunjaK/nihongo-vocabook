-- 029_ai_message_feedback.sql
-- Adds a per-message feedback column to ai_messages so users can rate
-- assistant responses. Phase 1.5 of the AI Assistant rollout.

ALTER TABLE ai_messages
  ADD COLUMN IF NOT EXISTS feedback text
    CHECK (feedback IS NULL OR feedback IN ('thumbs_up', 'thumbs_down'));

-- Lightweight index so per-user "show my rated messages" queries don't scan.
CREATE INDEX IF NOT EXISTS idx_ai_messages_feedback
  ON ai_messages (user_id, feedback)
  WHERE feedback IS NOT NULL;

COMMENT ON COLUMN ai_messages.feedback IS
  'User rating on this assistant message. NULL = no rating.';
