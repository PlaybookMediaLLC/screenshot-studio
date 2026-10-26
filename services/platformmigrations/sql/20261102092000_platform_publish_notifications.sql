-- Additive delivery preferences: old writers keep the workspace default.
ALTER TABLE platform_notification_policy
  ADD COLUMN IF NOT EXISTS social_set_slack_channels jsonb NOT NULL DEFAULT '{}';
ALTER TABLE content_draft
  ADD COLUMN IF NOT EXISTS "suppressSlackOnPublish" boolean NOT NULL DEFAULT false;
