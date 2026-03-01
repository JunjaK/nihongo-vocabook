ALTER TABLE quiz_settings
  ADD COLUMN notification_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN notification_hour smallint NOT NULL DEFAULT 9,
  ADD COLUMN notification_minute smallint NOT NULL DEFAULT 0;
