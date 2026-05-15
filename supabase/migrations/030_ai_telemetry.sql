-- 030_ai_telemetry.sql
-- Opt-in anonymous AI telemetry. Stores per-event counters / latencies WITHOUT
-- any message content, attachment data, or PII beyond user_id.
-- Phase 2 of the AI Assistant rollout (#4).

CREATE TABLE IF NOT EXISTS ai_telemetry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event text NOT NULL,
  -- Numeric counters / measurements. JSON allows variable shape per event
  -- (durationMs, outputTokens, toolName, errorCode, etc.) without churning
  -- the schema for new event types.
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Coarse-grained context: scope kind, model variant, platform — never the
  -- chat content.
  scope text,
  model_variant text,
  platform text,
  app_version text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_telemetry_user_created
  ON ai_telemetry (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_telemetry_event
  ON ai_telemetry (event);

ALTER TABLE ai_telemetry ENABLE ROW LEVEL SECURITY;

-- Users can insert their own telemetry; nobody can read it from the client
-- (admin/analytics path uses service-role keys).
CREATE POLICY "Users can insert own telemetry"
  ON ai_telemetry FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Defensive: explicit read denial. Service role bypasses RLS so analytics
-- queries still work.
CREATE POLICY "Nobody can select telemetry from client"
  ON ai_telemetry FOR SELECT
  USING (false);

COMMENT ON TABLE ai_telemetry IS
  'Opt-in anonymous AI usage telemetry. NEVER stores message content. Toggled by the user in Settings → AI Assistant.';
