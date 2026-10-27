ALTER TABLE store_review_comment ADD COLUMN "platformAuthorUserId" text;
-- No author backfill: display names and email addresses do not establish identity.
CREATE OR REPLACE FUNCTION platform_notification_member_removed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 DELETE FROM platform_notification_inbox WHERE "organizationId"=OLD."organizationId" AND "userId"=OLD."userId";
 DELETE FROM platform_notification_preference WHERE "organizationId"=OLD."organizationId" AND "userId"=OLD."userId";
 UPDATE platform_notification_delivery SET status=CASE WHEN status='CLAIMED' AND send_started_at IS NOT NULL THEN 'UNCERTAIN' ELSE 'SKIPPED' END,
 failure_code='MEMBERSHIP_REMOVED',encrypted_payload='',claim_token='',updated_at=now()
 WHERE "organizationId"=OLD."organizationId" AND destination=OLD."userId" AND channel IN ('email','in_app') AND status IN ('PENDING','BLOCKED','CLAIMED');
 RETURN OLD;
END $$;
