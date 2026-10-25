ALTER TABLE platform_social_observation ADD COLUMN "externalPost" jsonb;
ALTER TABLE platform_social_observation DROP CONSTRAINT platform_social_observation_kind_check;
ALTER TABLE platform_social_observation ADD CONSTRAINT platform_social_observation_kind_check CHECK (kind IN ('post','account','feed'));
