-- Keep recipient history; existing rows remain unseen. Previously deleted rows cannot be reconstructed safely.
ALTER TABLE platform_notification_inbox ADD COLUMN seen_at timestamptz;
ALTER TABLE platform_notification_inbox ADD COLUMN seen_action_id text NOT NULL DEFAULT '';
ALTER TABLE platform_notification_inbox ADD COLUMN context jsonb NOT NULL DEFAULT '{}';
ALTER TABLE platform_notification_seen_action ADD COLUMN undone_at timestamptz;
CREATE INDEX platform_notification_inbox_unseen ON platform_notification_inbox ("organizationId", "userId", created_at, id) WHERE seen_at IS NULL;
