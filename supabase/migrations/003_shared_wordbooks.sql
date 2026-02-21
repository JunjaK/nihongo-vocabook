-- Add sharing columns to wordbooks
ALTER TABLE wordbooks ADD COLUMN is_shared boolean NOT NULL DEFAULT false;
ALTER TABLE wordbooks ADD COLUMN is_system boolean NOT NULL DEFAULT false;
CREATE INDEX idx_wordbooks_shared ON wordbooks(is_shared) WHERE is_shared = true;

-- Create wordbook_subscriptions table
CREATE TABLE wordbook_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wordbook_id uuid REFERENCES wordbooks(id) ON DELETE CASCADE NOT NULL,
  subscriber_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE (wordbook_id, subscriber_id)
);
CREATE INDEX idx_wb_subs_subscriber ON wordbook_subscriptions(subscriber_id);
CREATE INDEX idx_wb_subs_wordbook ON wordbook_subscriptions(wordbook_id);

-- RLS for wordbook_subscriptions
ALTER TABLE wordbook_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own subscriptions"
  ON wordbook_subscriptions FOR SELECT
  USING (auth.uid() = subscriber_id);

CREATE POLICY "Users can subscribe to shared wordbooks"
  ON wordbook_subscriptions FOR INSERT
  WITH CHECK (
    auth.uid() = subscriber_id
    AND EXISTS (
      SELECT 1 FROM wordbooks
      WHERE wordbooks.id = wordbook_subscriptions.wordbook_id
      AND wordbooks.is_shared = true
    )
  );

CREATE POLICY "Users can unsubscribe"
  ON wordbook_subscriptions FOR DELETE
  USING (auth.uid() = subscriber_id);

-- Update wordbooks SELECT policy: own OR shared (for browsing)
DROP POLICY "Users can view own wordbooks" ON wordbooks;
CREATE POLICY "Users can view own or shared wordbooks"
  ON wordbooks FOR SELECT
  USING (
    auth.uid() = user_id
    OR (is_shared = true AND auth.role() = 'authenticated')
  );

-- Update wordbook_items SELECT policy: own OR subscribed shared wordbooks
DROP POLICY "Users can view own wordbook items" ON wordbook_items;
CREATE POLICY "Users can view own or subscribed wordbook items"
  ON wordbook_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM wordbooks
      WHERE wordbooks.id = wordbook_items.wordbook_id
      AND wordbooks.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM wordbook_subscriptions
      WHERE wordbook_subscriptions.wordbook_id = wordbook_items.wordbook_id
      AND wordbook_subscriptions.subscriber_id = auth.uid()
    )
  );

-- Allow reading words from subscribed shared wordbooks
CREATE POLICY "Users can view words from subscribed wordbooks"
  ON words FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM wordbook_items
      JOIN wordbook_subscriptions ON wordbook_subscriptions.wordbook_id = wordbook_items.wordbook_id
      WHERE wordbook_items.word_id = words.id
      AND wordbook_subscriptions.subscriber_id = auth.uid()
    )
  );

-- Helper function to get user email (for displaying wordbook owner)
CREATE OR REPLACE FUNCTION get_user_email(uid uuid) RETURNS text
  LANGUAGE sql SECURITY DEFINER
  AS $$ SELECT email FROM auth.users WHERE id = uid; $$;
