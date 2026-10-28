-- Additive; existing source behavior is marked explicitly, never reinterpreted.
CREATE TABLE github_production_policy (
 id TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
 "sourceAppId" TEXT NOT NULL REFERENCES source_app(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL, policy JSONB NOT NULL, "createdBy" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("organizationId","sourceAppId",revision)
);
INSERT INTO github_production_policy (id,"organizationId","sourceAppId",revision,policy,"createdBy")
SELECT 'legacy-' || id,"organizationId",id,0,'{"schemaVersion":0,"enabled":false}'::jsonb,'migration'
FROM source_app WHERE provider='github';
CREATE TABLE github_observation (
 id TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
 "sourceAppId" TEXT NOT NULL REFERENCES source_app(id) ON DELETE CASCADE,
 "semanticKey" TEXT NOT NULL,"objectKey" TEXT NOT NULL,"deliveryId" TEXT NOT NULL,evidence JSONB NOT NULL,enrichment JSONB,
 "policyId" TEXT REFERENCES github_production_policy(id),"workflowVersionId" TEXT REFERENCES release_automation_version(id),
 origin TEXT NOT NULL DEFAULT 'live',status TEXT NOT NULL DEFAULT 'received',decision JSONB NOT NULL DEFAULT '{}',
 "eventId" TEXT REFERENCES release_source_event(id),"duplicateCount" INTEGER NOT NULL DEFAULT 0,
 "occurredAt" TIMESTAMP(3),"receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"processedAt" TIMESTAMP(3),
 UNIQUE ("organizationId","sourceAppId","semanticKey")
);
CREATE INDEX github_observation_history ON github_observation("organizationId","sourceAppId","receivedAt");
CREATE INDEX github_observation_ordering ON github_observation("organizationId","sourceAppId","objectKey","occurredAt");
CREATE TABLE github_delivery_recovery (
 id TEXT PRIMARY KEY,guid TEXT NOT NULL UNIQUE,"installationId" BIGINT NOT NULL,"repositoryId" TEXT NOT NULL,"eventName" TEXT NOT NULL,
 "deliveredAt" TIMESTAMP(3) NOT NULL,"statusCode" INTEGER NOT NULL,recovery BOOLEAN NOT NULL DEFAULT false,
 attempts INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'failed',"nextAttemptAt" TIMESTAMP(3),"updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX github_recovery_repository ON github_delivery_recovery("installationId","repositoryId","deliveredAt");
CREATE TABLE github_recovery_scan (
 id TEXT PRIMARY KEY,"organizationId" TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,"sourceAppId" TEXT NOT NULL REFERENCES source_app(id) ON DELETE CASCADE,
 cursor TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'unknown',reason TEXT NOT NULL DEFAULT 'Delivery history has not been inspected.',gap BOOLEAN NOT NULL DEFAULT true,
 "windowStart" TIMESTAMP(3),"lastCompleteAt" TIMESTAMP(3),"nextAttemptAt" TIMESTAMP(3),"updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("organizationId","sourceAppId")
);
-- Rollback: pause policy processing and retain these tables/receipts. Dropping
-- them would erase idempotency, history and the recovery suppression boundary.
