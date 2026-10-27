-- The settings platform (RFC 024): personal preferences, social sets with
-- their schedules, defaults, public profiles and Writing Assistant, outbound
-- customer webhooks, and account deletion requests. Additive only: no column
-- is dropped and no stored instant changes.

-- A person's preferences, kept with the person so they follow them across
-- workspaces.
CREATE TABLE "user_preference" (
  "userId" TEXT PRIMARY KEY REFERENCES "user"("id") ON DELETE CASCADE,
  "timeZone" TEXT,
  "theme" TEXT NOT NULL DEFAULT 'dark' CHECK ("theme" IN ('light', 'dark', 'system')),
  "navigation" TEXT NOT NULL DEFAULT 'compact' CHECK ("navigation" IN ('compact', 'dynamic', 'expanded')),
  "weekStart" TEXT NOT NULL DEFAULT 'monday' CHECK ("weekStart" IN ('monday', 'sunday')),
  "textDirection" TEXT NOT NULL DEFAULT 'ltr' CHECK ("textDirection" IN ('ltr', 'rtl')),
  "showScrollbars" BOOLEAN NOT NULL DEFAULT true,
  "developerMode" BOOLEAN NOT NULL DEFAULT false,
  "emailNotifications" BOOLEAN NOT NULL DEFAULT true,
  "dismissedTips" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "experiments" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "version" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- A request to delete a person's account, carried out after a grace period.
CREATE TABLE "account_deletion_request" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "status" TEXT NOT NULL DEFAULT 'REQUESTED' CHECK ("status" IN ('REQUESTED', 'CANCELLED', 'COMPLETED')),
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "executeAfter" TIMESTAMP(3) NOT NULL,
  "cancelledAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3)
);
CREATE UNIQUE INDEX "account_deletion_request_open_key" ON "account_deletion_request" ("userId") WHERE "status" = 'REQUESTED';
CREATE INDEX "account_deletion_request_due_idx" ON "account_deletion_request" ("executeAfter") WHERE "status" = 'REQUESTED';

-- A publishing identity: the accounts one person or brand posts from.
CREATE TABLE "social_set" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL CHECK (char_length(btrim("name")) BETWEEN 1 AND 80),
  "color" TEXT NOT NULL DEFAULT '#3b82f6' CHECK ("color" ~ '^#[0-9a-f]{6}$'),
  "visibility" TEXT NOT NULL DEFAULT 'WORKSPACE' CHECK ("visibility" IN ('WORKSPACE', 'PRIVATE')),
  "ownerUserId" TEXT,
  "timeZone" TEXT NOT NULL DEFAULT 'UTC',
  "postingSlots" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "naturalPostingTimes" BOOLEAN NOT NULL DEFAULT false,
  "defaultPlatforms" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "primaryPlatform" TEXT,
  "engagementDefaults" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "publicProfile" BOOLEAN NOT NULL DEFAULT false,
  "publicSlug" TEXT NOT NULL,
  "writingAssistant" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "social_set_private_owner" CHECK ("visibility" <> 'PRIVATE' OR "ownerUserId" IS NOT NULL)
);
CREATE UNIQUE INDEX "social_set_publicSlug_key" ON "social_set" ("publicSlug");
-- The composite key lets a connection or draft reference only a set of its own workspace.
CREATE UNIQUE INDEX "social_set_organizationId_id_key" ON "social_set" ("organizationId", "id");
CREATE INDEX "social_set_organizationId_createdAt_idx" ON "social_set" ("organizationId", "createdAt") WHERE "deletedAt" IS NULL;

CREATE TABLE "social_set_writing_sample" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "socialSetId" TEXT NOT NULL,
  "text" TEXT NOT NULL CHECK (char_length("text") BETWEEN 1 AND 5000),
  "source" TEXT NOT NULL CHECK ("source" IN ('manual', 'draft')),
  "sourceDraftId" TEXT,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("organizationId", "socialSetId") REFERENCES "social_set" ("organizationId", "id")
);
CREATE INDEX "social_set_writing_sample_set_idx" ON "social_set_writing_sample" ("socialSetId", "createdAt");

ALTER TABLE "channel_connection" ADD COLUMN "socialSetId" TEXT;
ALTER TABLE "channel_connection" ADD CONSTRAINT "channel_connection_socialSetId_fkey"
  FOREIGN KEY ("organizationId", "socialSetId") REFERENCES "social_set" ("organizationId", "id");
-- One active account per platform in a set.
CREATE UNIQUE INDEX "channel_connection_socialSetId_platform_key" ON "channel_connection" ("socialSetId", "platform")
  WHERE "status" = 'ACTIVE' AND "socialSetId" IS NOT NULL;

ALTER TABLE "social_oauth_start" ADD COLUMN "socialSetId" TEXT;

-- What a new draft copied from its set, plus tags and calendar planning.
ALTER TABLE "content_draft" ADD COLUMN "socialSetId" TEXT;
ALTER TABLE "content_draft" ADD COLUMN "primaryPlatform" TEXT;
ALTER TABLE "content_draft" ADD COLUMN "naturalPostingTime" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "content_draft" ADD COLUMN "engagement" JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE "content_draft" ADD COLUMN "tags" JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "content_draft" ADD COLUMN "plannedFor" TIMESTAMP(3);
ALTER TABLE "content_draft" ADD CONSTRAINT "content_draft_socialSetId_fkey"
  FOREIGN KEY ("organizationId", "socialSetId") REFERENCES "social_set" ("organizationId", "id");
CREATE INDEX "content_draft_socialSetId_updatedAt_idx" ON "content_draft" ("socialSetId", "updatedAt");

-- How each post's instant was chosen, so it can be explained and replayed.
ALTER TABLE "scheduled_post" ADD COLUMN "socialSetId" TEXT;
ALTER TABLE "scheduled_post" ADD COLUMN "scheduleMode" TEXT CHECK ("scheduleMode" IN ('queue', 'explicit'));
ALTER TABLE "scheduled_post" ADD COLUMN "slotAt" TIMESTAMP(3);
ALTER TABLE "scheduled_post" ADD COLUMN "naturalOffsetSeconds" INTEGER CHECK ("naturalOffsetSeconds" BETWEEN -240 AND 240);
ALTER TABLE "scheduled_post" ADD COLUMN "scheduleTimeZone" TEXT;
CREATE INDEX "scheduled_post_socialSetId_slotAt_idx" ON "scheduled_post" ("socialSetId", "slotAt") WHERE "socialSetId" IS NOT NULL;

ALTER TABLE "workspace_settings" ADD COLUMN "disabledExperiments" JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "platform_notification_preference" ADD COLUMN social_sets JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Outbound customer webhooks (RFC 015 and RFC 024).
CREATE TABLE "webhook_subscription" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL CHECK (char_length(btrim("name")) BETWEEN 1 AND 80),
  "url" TEXT NOT NULL CHECK ("url" LIKE 'https://%'),
  "events" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "encryptedSecret" TEXT NOT NULL,
  "previousEncryptedSecret" TEXT,
  "previousSecretExpiresAt" TIMESTAMP(3),
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSuccessAt" TIMESTAMP(3),
  "lastFailureAt" TIMESTAMP(3)
);
CREATE INDEX "webhook_subscription_organizationId_createdAt_idx" ON "webhook_subscription" ("organizationId", "createdAt");

CREATE TABLE "webhook_delivery" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "subscriptionId" TEXT NOT NULL REFERENCES "webhook_subscription"("id") ON DELETE CASCADE,
  "eventId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  -- The exact bytes signed and sent, so every retry sends the same body.
  "body" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING', 'SENDING', 'SUCCEEDED', 'DEAD')),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseUntil" TIMESTAMP(3),
  "lastAttemptAt" TIMESTAMP(3),
  "responseStatus" INTEGER,
  "errorClass" TEXT,
  "manual" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("subscriptionId", "eventId")
);
CREATE INDEX "webhook_delivery_due_idx" ON "webhook_delivery" ("status", "nextAttemptAt");
CREATE INDEX "webhook_delivery_subscription_idx" ON "webhook_delivery" ("subscriptionId", "createdAt");

CREATE TABLE "webhook_delivery_attempt" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "deliveryId" TEXT NOT NULL REFERENCES "webhook_delivery"("id") ON DELETE CASCADE,
  "attemptNumber" INTEGER NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "durationMs" INTEGER NOT NULL,
  "outcome" TEXT NOT NULL CHECK ("outcome" IN ('SUCCEEDED', 'FAILED')),
  "responseStatus" INTEGER,
  "errorClass" TEXT,
  UNIQUE ("deliveryId", "attemptNumber")
);

-- Backfill. Every live workspace gets a default set from its name, its
-- workspace time zone, and its saved posting slots (weekdays at 09:00 when it
-- never saved any). The oldest account of each platform joins it; the n-th account
-- of a platform joins set n, so the one-per-platform rule holds.
WITH accounts AS (
  SELECT c."organizationId", row_number() OVER (PARTITION BY c."organizationId", c."platform" ORDER BY c."createdAt", c."id") AS rank
  FROM "channel_connection" c
), sets AS (
  SELECT o."id" AS org, ranks.rank
  FROM "organization" o
  CROSS JOIN LATERAL (
    SELECT 1::bigint AS rank
    UNION SELECT a.rank FROM accounts a WHERE a."organizationId" = o."id"
  ) ranks
  WHERE NOT EXISTS (SELECT 1 FROM "workspace_deletion" w WHERE w."organizationId" = o."id" AND w."status" = 'PURGED')
)
INSERT INTO "social_set" ("id", "organizationId", "name", "timeZone", "postingSlots", "publicSlug")
SELECT 'c' || substr(md5(s.org || ':set:' || s.rank), 1, 24), s.org,
  left(coalesce(nullif(btrim(o."name"), ''), 'Workspace'), 72) || CASE WHEN s.rank > 1 THEN ' ' || s.rank ELSE '' END,
  coalesce(ws."timeZone", 'UTC'),
  CASE WHEN cds."organizationId" IS NULL
    THEN '[{"time":"09:00","weekday":1},{"time":"09:00","weekday":2},{"time":"09:00","weekday":3},{"time":"09:00","weekday":4},{"time":"09:00","weekday":5}]'::jsonb
    ELSE cds."postingSlots" END,
  replace(gen_random_uuid()::text, '-', '')
FROM sets s
JOIN "organization" o ON o."id" = s.org
LEFT JOIN "workspace_settings" ws ON ws."organizationId" = s.org
LEFT JOIN "content_draft_settings" cds ON cds."organizationId" = s.org
ON CONFLICT ("id") DO NOTHING;

UPDATE "channel_connection" c SET "socialSetId" = 'c' || substr(md5(c."organizationId" || ':set:' || ranked.rank), 1, 24)
FROM (
  SELECT "id", row_number() OVER (PARTITION BY "organizationId", "platform" ORDER BY "createdAt", "id") AS rank
  FROM "channel_connection"
) ranked
WHERE ranked."id" = c."id" AND c."socialSetId" IS NULL
  AND EXISTS (SELECT 1 FROM "social_set" s WHERE s."id" = 'c' || substr(md5(c."organizationId" || ':set:' || ranked.rank), 1, 24));

UPDATE "content_draft" d SET "socialSetId" = coalesce(
  (SELECT c."socialSetId" FROM "channel_connection" c WHERE c."organizationId" = d."organizationId" AND c."id" = d."channelConnectionIds"->>0),
  'c' || substr(md5(d."organizationId" || ':set:1'), 1, 24))
WHERE d."socialSetId" IS NULL
  AND EXISTS (SELECT 1 FROM "social_set" s WHERE s."id" = 'c' || substr(md5(d."organizationId" || ':set:1'), 1, 24));

-- Draft posts keep their instants; they only learn their set and slot.
UPDATE "scheduled_post" p SET "socialSetId" = d."socialSetId", "slotAt" = date_trunc('minute', p."scheduledFor")
FROM "content_draft" d
WHERE p."contentDraftId" = d."id" AND p."socialSetId" IS NULL;
