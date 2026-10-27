-- Screenshot Studio workspace profile, recovery deletion, and one active
-- invitation per normalized recipient. Retain the newest usable invitation
-- when legacy data has more than one for the same recipient, then make the
-- invariant database-enforced.
UPDATE "invitation"
SET "status" = 'expired'
WHERE "status" = 'pending' AND "expiresAt" <= CURRENT_TIMESTAMP;

UPDATE "invitation"
SET "email" = lower("email")
WHERE "email" <> lower("email");

WITH ranked_pending_invitations AS (
    SELECT
        "id",
        row_number() OVER (
            PARTITION BY "organizationId", lower("email")
            ORDER BY "createdAt" DESC, "id" DESC
        ) AS invitation_rank
    FROM "invitation"
    WHERE "status" = 'pending' AND "expiresAt" > CURRENT_TIMESTAMP
)
UPDATE "invitation"
SET "status" = 'canceled'
FROM ranked_pending_invitations
WHERE "invitation"."id" = ranked_pending_invitations."id"
  AND ranked_pending_invitations.invitation_rank > 1;

CREATE UNIQUE INDEX "invitation_organizationId_activeRecipient_key"
ON "invitation"("organizationId", lower("email"))
WHERE "status" = 'pending';

CREATE INDEX "invitation_organizationId_status_createdAt_idx"
ON "invitation"("organizationId", "status", "createdAt");

WITH ranked_owners AS (
    SELECT
        "id",
        row_number() OVER (
            PARTITION BY "organizationId"
            ORDER BY "createdAt" ASC, "id" ASC
        ) AS owner_rank
    FROM "member"
    WHERE "role" = 'owner'
)
UPDATE "member"
SET "role" = 'admin'
FROM ranked_owners
WHERE "member"."id" = ranked_owners."id"
  AND ranked_owners.owner_rank > 1;

CREATE UNIQUE INDEX "member_organizationId_owner_key"
ON "member"("organizationId")
WHERE "role" = 'owner';

CREATE TABLE "workspace_settings" (
    "organizationId" TEXT NOT NULL,
    "description" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "timeZone" TEXT NOT NULL DEFAULT 'UTC',
    "defaultPublishTime" TEXT NOT NULL DEFAULT '09:00',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "workspace_settings_pkey" PRIMARY KEY ("organizationId")
);

CREATE TYPE "WorkspaceDeletionStatus" AS ENUM ('PENDING', 'PROCESSING', 'CANCELLED', 'PURGED');

CREATE TABLE "workspace_deletion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "status" "WorkspaceDeletionStatus" NOT NULL DEFAULT 'PENDING',
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "processingAt" TIMESTAMP(3),
    "purgedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "workspace_deletion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "workspace_deletion_organizationId_key" ON "workspace_deletion"("organizationId");
CREATE INDEX "workspace_deletion_status_scheduledFor_idx" ON "workspace_deletion"("status", "scheduledFor");
CREATE INDEX "workspace_deletion_requestedByUserId_status_idx" ON "workspace_deletion"("requestedByUserId", "status");

ALTER TABLE "workspace_settings"
ADD CONSTRAINT "workspace_settings_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "workspace_deletion"
ADD CONSTRAINT "workspace_deletion_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "workspace_deletion"
ADD CONSTRAINT "workspace_deletion_requestedByUserId_fkey"
FOREIGN KEY ("requestedByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
