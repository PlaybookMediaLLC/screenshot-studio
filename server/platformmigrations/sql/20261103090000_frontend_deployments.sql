-- Additive opt-in. No existing source, capture, notification or workflow is rewritten.
-- Apply before API/worker/web rollout. Disable sources before rolling code back;
-- retain these tables and queued work. No historical activation is replayed.
CREATE TABLE frontend_source (
 id TEXT PRIMARY KEY REFERENCES source_app(id) ON DELETE CASCADE,
 "organizationId" TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
 provider TEXT NOT NULL, "accountId" TEXT NOT NULL, "projectId" TEXT NOT NULL,
 "githubSourceId" TEXT NOT NULL DEFAULT '',
 policy JSONB NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
 enabled BOOLEAN NOT NULL DEFAULT false,
 "encryptedToken" TEXT NOT NULL DEFAULT '', "encryptedSecret" TEXT NOT NULL DEFAULT '',
 "baselineAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "lastPollAt" TIMESTAMP(3), health TEXT NOT NULL DEFAULT 'baseline_pending',
 checkpoint JSONB NOT NULL DEFAULT '{}', "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("organizationId",provider,"accountId","projectId")
);
CREATE INDEX frontend_source_github ON frontend_source("organizationId","githubSourceId");
CREATE INDEX frontend_source_due ON frontend_source(enabled,"lastPollAt");
CREATE TABLE frontend_observation (
 id TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
 "sourceId" TEXT NOT NULL REFERENCES frontend_source(id) ON DELETE CASCADE,
 "eventKey" TEXT NOT NULL, snapshot JSONB NOT NULL, policy JSONB NOT NULL,
 "policyVersion" INTEGER NOT NULL, decision JSONB NOT NULL, historical BOOLEAN NOT NULL,
 "occurredAt" TIMESTAMP(3) NOT NULL, "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("sourceId","eventKey")
);
CREATE INDEX frontend_observation_history ON frontend_observation("organizationId","sourceId","receivedAt");
CREATE TABLE frontend_activation (
 id TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
 "sourceId" TEXT NOT NULL REFERENCES frontend_source(id) ON DELETE CASCADE,
 "activationKey" TEXT NOT NULL, "commitSha" TEXT NOT NULL DEFAULT '',
 snapshot JSONB NOT NULL, policy JSONB NOT NULL, "policyVersion" INTEGER NOT NULL,
 decision JSONB NOT NULL, historical BOOLEAN NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("sourceId","activationKey")
);
CREATE INDEX frontend_activation_revision ON frontend_activation("organizationId","sourceId","commitSha");
CREATE INDEX frontend_activation_history ON frontend_activation("organizationId","createdAt");
