-- Add per-rating count columns to daily_stats
ALTER TABLE daily_stats ADD COLUMN hard_count integer NOT NULL DEFAULT 0;
ALTER TABLE daily_stats ADD COLUMN good_count integer NOT NULL DEFAULT 0;
ALTER TABLE daily_stats ADD COLUMN easy_count integer NOT NULL DEFAULT 0;
ALTER TABLE daily_stats ADD COLUMN mastered_in_session_count integer NOT NULL DEFAULT 0;
