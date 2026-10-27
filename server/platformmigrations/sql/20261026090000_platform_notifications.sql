ALTER TABLE outbox_event ADD COLUMN notification_version integer NOT NULL DEFAULT 0;
ALTER TABLE outbox_event ADD COLUMN notification_fanned boolean NOT NULL DEFAULT false;
CREATE INDEX outbox_notification_pending ON outbox_event ("createdAt", id) WHERE notification_version=1 AND NOT notification_fanned;

CREATE TABLE platform_notification_policy (
 "organizationId" text PRIMARY KEY REFERENCES organization(id) ON DELETE CASCADE,
 events jsonb NOT NULL DEFAULT '{}', generation integer NOT NULL DEFAULT 1,
 slack_connection_id text NOT NULL DEFAULT '', slack_channel_id text NOT NULL DEFAULT '', slack_channel_name text NOT NULL DEFAULT '',
 enabled_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE platform_notification_preference (
 id text PRIMARY KEY, "organizationId" text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
 "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE, events jsonb NOT NULL DEFAULT '{}',
 generation integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE("organizationId","userId")
);
CREATE TABLE platform_notification_inbox (
 id text PRIMARY KEY, "organizationId" text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
 "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE, event_id text NOT NULL,
 kind text NOT NULL, resource_type text NOT NULL, resource_id text NOT NULL,
 description text NOT NULL, href text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE("organizationId","userId",event_id)
);
CREATE INDEX platform_notification_inbox_page ON platform_notification_inbox ("organizationId","userId",created_at,id);
CREATE TABLE platform_notification_delivery (
 id text PRIMARY KEY, "organizationId" text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
 event_id text NOT NULL, kind text NOT NULL, channel text NOT NULL CHECK(channel IN ('in_app','email','slack')),
 destination text NOT NULL, status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','CLAIMED','SUCCEEDED','SKIPPED','BLOCKED','UNCERTAIN','DEAD')),
 policy_generation integer NOT NULL DEFAULT 1, preference_generation integer NOT NULL DEFAULT 1,
 connection_id text NOT NULL DEFAULT '', claim_token text NOT NULL DEFAULT '', claimed_at timestamptz, send_started_at timestamptz,
 attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(),
 failure_code text NOT NULL DEFAULT '', provider_receipt text NOT NULL DEFAULT '', encrypted_payload text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE("organizationId",event_id,channel,destination)
);
CREATE INDEX platform_notification_delivery_due ON platform_notification_delivery (status,next_attempt_at);
CREATE TABLE platform_notification_seen_action (
 id text PRIMARY KEY, "organizationId" text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
 "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE, request_key text NOT NULL,
 deleted_count integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE("organizationId","userId",request_key)
);
CREATE TABLE platform_slack_installation (
 id text PRIMARY KEY, app_id text NOT NULL, team_id text NOT NULL, enterprise_id text NOT NULL DEFAULT '', team_name text NOT NULL,
 encrypted_credentials text NOT NULL, scopes jsonb NOT NULL DEFAULT '[]', expires_at timestamptz,
 health text NOT NULL DEFAULT 'CONNECTED', refresh_claim text NOT NULL DEFAULT '', refresh_started_at timestamptz, checked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(app_id,team_id,enterprise_id)
);
CREATE TABLE platform_slack_connection (
 id text PRIMARY KEY, "organizationId" text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
 installation_id text NOT NULL REFERENCES platform_slack_installation(id), legacy_social_id text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE("organizationId",installation_id)
);

-- Membership deletion also covers Better Auth/SCIM writes outside product endpoints.
CREATE FUNCTION platform_notification_member_removed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 DELETE FROM platform_notification_inbox WHERE "organizationId"=OLD."organizationId" AND "userId"=OLD."userId";
 DELETE FROM platform_notification_preference WHERE "organizationId"=OLD."organizationId" AND "userId"=OLD."userId";
 UPDATE platform_notification_delivery SET status='SKIPPED',failure_code='MEMBERSHIP_REMOVED',encrypted_payload='',updated_at=now()
 WHERE "organizationId"=OLD."organizationId" AND destination=OLD."userId" AND channel IN ('email','in_app') AND status IN ('PENDING','BLOCKED');
 RETURN OLD;
END $$;
CREATE TRIGGER platform_notification_member_removed AFTER DELETE ON member FOR EACH ROW EXECUTE FUNCTION platform_notification_member_removed();
