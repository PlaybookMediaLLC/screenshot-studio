-- Personal appearance only; existing users retain the default theme palette.
ALTER TABLE user_preference ADD COLUMN IF NOT EXISTS "accentColor" text NOT NULL DEFAULT '';
ALTER TABLE user_preference DROP CONSTRAINT IF EXISTS user_preference_accent_color_check;
ALTER TABLE user_preference ADD CONSTRAINT user_preference_accent_color_check CHECK ("accentColor" = '' OR "accentColor" ~ '^#[0-9a-fA-F]{6}$');
