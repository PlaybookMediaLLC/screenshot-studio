-- Personal DM destinations are owned by a current member, not workspace admins.
CREATE TABLE platform_slack_personal_connection (
 id text PRIMARY KEY,
 "organizationId" text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
 "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 member_id text NOT NULL REFERENCES member(id) ON DELETE CASCADE,
 installation_id text NOT NULL REFERENCES platform_slack_installation(id),
 slack_user_id text NOT NULL CHECK(slack_user_id ~ '^[UW][A-Z0-9]{1,64}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE("organizationId","userId")
);
CREATE INDEX platform_slack_personal_installation ON platform_slack_personal_connection(installation_id);

ALTER TABLE platform_notification_delivery DROP CONSTRAINT platform_notification_delivery_channel_check;
ALTER TABLE platform_notification_delivery ADD CONSTRAINT platform_notification_delivery_channel_check
 CHECK(channel IN ('in_app','email','slack','slack_dm'));

-- Covers local disconnect and membership deletion (including SCIM cascades).
CREATE FUNCTION platform_slack_personal_removed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE platform_notification_delivery
 SET status=CASE WHEN status='CLAIMED' AND send_started_at IS NOT NULL THEN 'UNCERTAIN' ELSE 'SKIPPED' END,
 failure_code='DISCONNECTED',encrypted_payload='',claim_token='',updated_at=now()
 WHERE "organizationId"=OLD."organizationId" AND destination=OLD."userId"
 AND channel='slack_dm' AND connection_id=OLD.id AND status IN ('PENDING','BLOCKED','CLAIMED');
 RETURN OLD;
END $$;
CREATE TRIGGER platform_slack_personal_removed AFTER DELETE ON platform_slack_personal_connection
 FOR EACH ROW EXECUTE FUNCTION platform_slack_personal_removed();
