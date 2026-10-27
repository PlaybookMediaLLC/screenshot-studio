-- Recipient state is independent of delivery receipts and immutable activity.
-- Existing unread receipts stay unread; previously acknowledged rows cannot be recovered.
ALTER TABLE platform_notification_inbox
  ADD COLUMN category text NOT NULL DEFAULT 'activity'
    CHECK (category IN ('inbox', 'activity')),
  ADD COLUMN read_at timestamptz,
  ADD COLUMN archived_at timestamptz;

UPDATE platform_notification_inbox SET category = 'inbox'
WHERE kind IN ('campaign_posts.submitted', 'campaign_posts.decided', 'variant.ready',
  'variant.decided', 'brief.approved', 'plan.approved', 'draft.review_requested',
  'draft.approved', 'draft.changes_requested', 'comment.created', 'comment.on_your_draft',
  'comment.resolved', 'member.mentioned');

CREATE INDEX platform_notification_inbox_active_category
  ON platform_notification_inbox ("organizationId", "userId", category, created_at DESC, id DESC)
  WHERE archived_at IS NULL;
CREATE INDEX platform_notification_inbox_archive
  ON platform_notification_inbox ("organizationId", "userId", created_at DESC, id DESC)
  WHERE archived_at IS NOT NULL;
CREATE INDEX platform_notification_inbox_unread
  ON platform_notification_inbox ("organizationId", "userId")
  WHERE archived_at IS NULL AND read_at IS NULL;

-- Reuse the existing durable bulk-action receipt for all recipient state changes.
ALTER TABLE platform_notification_seen_action
  ADD COLUMN request_fingerprint text NOT NULL DEFAULT '';
