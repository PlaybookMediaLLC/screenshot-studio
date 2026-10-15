ALTER TABLE "workspace_entitlement"
ADD COLUMN "graceUntil" TIMESTAMP(3),
ADD COLUMN "provider" TEXT,
ADD COLUMN "externalCustomerId" TEXT,
ADD COLUMN "externalSubscriptionId" TEXT,
ADD COLUMN "lastSyncedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "workspace_entitlement_provider_externalSubscriptionId_key"
ON "workspace_entitlement"("provider", "externalSubscriptionId");

CREATE TABLE "billing_entitlement_event" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "entitlementVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_entitlement_event_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "billing_entitlement_event_provider_eventId_key"
ON "billing_entitlement_event"("provider", "eventId");
CREATE INDEX "billing_entitlement_event_organizationId_createdAt_idx"
ON "billing_entitlement_event"("organizationId", "createdAt");

ALTER TABLE "billing_entitlement_event"
ADD CONSTRAINT "billing_entitlement_event_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
