-- Additive: legacy all-channel opt-outs remain in social_sets.
ALTER TABLE platform_notification_preference
 ADD COLUMN social_set_channels jsonb NOT NULL DEFAULT '{}';
