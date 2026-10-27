-- Retain channel-master choices and safe projection decisions in the existing engine.
ALTER TABLE platform_notification_preference ADD COLUMN slack_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE platform_notification_delivery ADD COLUMN decision_code text NOT NULL DEFAULT 'LEGACY';
