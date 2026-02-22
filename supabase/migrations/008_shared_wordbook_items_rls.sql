-- Allow any authenticated user to view wordbook_items from shared wordbooks.
-- Previously only owners and subscribers could see items, which made the
-- browse page show 0 words for system/shared wordbooks.

DROP POLICY IF EXISTS "Users can view own or subscribed wordbook items" ON wordbook_items;

CREATE POLICY "Users can view own or shared wordbook items"
  ON wordbook_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM wordbooks
      WHERE wordbooks.id = wordbook_items.wordbook_id
      AND (
        wordbooks.user_id = auth.uid()
        OR (wordbooks.is_shared = true AND auth.role() = 'authenticated')
      )
    )
  );
