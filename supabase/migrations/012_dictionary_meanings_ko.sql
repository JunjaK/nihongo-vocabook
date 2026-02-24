-- Add Korean meanings column to dictionary_entries
ALTER TABLE dictionary_entries ADD COLUMN IF NOT EXISTS meanings_ko text[] DEFAULT '{}';
