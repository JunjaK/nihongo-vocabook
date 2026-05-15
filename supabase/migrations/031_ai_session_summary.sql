-- 031_ai_session_summary.sql
-- Persisted auto-summary of older messages so long chat sessions can keep
-- earlier context without overflowing the on-device model's token budget.
-- Phase 2 of the AI Assistant rollout (#5).

ALTER TABLE ai_sessions
  ADD COLUMN IF NOT EXISTS context_summary text,
  ADD COLUMN IF NOT EXISTS summarized_through_message_id uuid
    REFERENCES ai_messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS summarized_message_count integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN ai_sessions.context_summary IS
  'Auto-generated summary of older messages, inserted as a system addendum during inference. Regenerated as the session grows.';
