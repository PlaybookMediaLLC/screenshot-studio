ALTER TABLE platform_notification_policy ADD COLUMN availability jsonb NOT NULL DEFAULT '{"inApp":true,"email":true,"slack":true}';
