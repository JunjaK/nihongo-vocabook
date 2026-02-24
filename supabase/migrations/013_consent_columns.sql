-- Add consent tracking columns to user_settings
ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS privacy_agreed_at timestamptz,
  ADD COLUMN IF NOT EXISTS storage_agreed_at timestamptz;

-- Update handle_new_user to set privacy_agreed_at from signup metadata
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.user_settings (user_id, jlpt_level, nickname, privacy_agreed_at)
  VALUES (
    NEW.id,
    (NEW.raw_user_meta_data->>'jlpt_level')::integer,
    'user-' || substr(NEW.id::text, 1, 8),
    CASE
      WHEN (NEW.raw_user_meta_data->>'privacy_agreed')::boolean = true THEN now()
      ELSE NULL
    END
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
