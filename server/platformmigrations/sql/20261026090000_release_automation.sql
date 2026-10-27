-- Additive rollout: migrate, deploy compatible workers, backend/SDK, then web.
ALTER TABLE source_app ADD COLUMN "releaseAutomation" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE source_app ADD COLUMN "automationCollectUnmatched" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE release_automation (
  id TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  "sourceAppId" TEXT NOT NULL REFERENCES source_app(id) ON DELETE CASCADE,
  name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', family TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0, "activePriority" INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 1,
  enabled BOOLEAN NOT NULL DEFAULT false, "activeVersionId" TEXT,
  draft JSONB NOT NULL, layout JSONB NOT NULL DEFAULT '{}', "modifiedBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX release_automation_scope ON release_automation("organizationId","sourceAppId",family,priority);
CREATE TABLE release_automation_version (
  id TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  "definitionId" TEXT NOT NULL REFERENCES release_automation(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL, graph JSONB NOT NULL, "contentHash" TEXT NOT NULL,
  "activatedBy" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("definitionId",revision)
);
CREATE INDEX release_automation_version_tenant ON release_automation_version("organizationId","createdAt");
CREATE TABLE release_source_event (
  id TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  "sourceAppId" TEXT NOT NULL REFERENCES source_app(id) ON DELETE CASCADE,
  "semanticKey" TEXT NOT NULL, "deliveryId" TEXT NOT NULL,
  snapshot JSONB NOT NULL, "versionIds" JSONB NOT NULL,
  "collectUnmatched" BOOLEAN NOT NULL DEFAULT true,
  mode TEXT NOT NULL, disposition TEXT NOT NULL DEFAULT 'queued', reason TEXT NOT NULL DEFAULT '',
  enrichment JSONB NOT NULL DEFAULT '{}', "enrichedAt" TIMESTAMP(3),
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("organizationId","sourceAppId","semanticKey")
);
CREATE INDEX release_source_event_tenant ON release_source_event("organizationId","receivedAt");
CREATE TABLE release_automation_run (
  id TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  "eventId" TEXT NOT NULL UNIQUE REFERENCES release_source_event(id) ON DELETE CASCADE,
  "definitionId" TEXT REFERENCES release_automation(id),
  "versionId" TEXT REFERENCES release_automation_version(id),
  "workflowId" TEXT NOT NULL UNIQUE, "temporalRunId" TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued', "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
  "recoveryAttempt" INTEGER NOT NULL DEFAULT 0,
  "failureCode" TEXT NOT NULL DEFAULT '', reason TEXT NOT NULL DEFAULT '', outputs JSONB NOT NULL DEFAULT '{}',
  "startedAt" TIMESTAMP(3), "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX release_automation_run_tenant ON release_automation_run("organizationId",status,"createdAt");
CREATE TABLE release_automation_node (
  id TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  "runId" TEXT NOT NULL REFERENCES release_automation_run(id) ON DELETE CASCADE,
  "nodeId" TEXT NOT NULL, "actionKey" TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running', attempts INTEGER NOT NULL DEFAULT 1,
  "failureCode" TEXT NOT NULL DEFAULT '', decision JSONB, outputs JSONB NOT NULL DEFAULT '{}',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "completedAt" TIMESTAMP(3),
  UNIQUE ("runId","nodeId"), UNIQUE ("organizationId","actionKey")
);
CREATE TABLE release_automation_executor (
  id TEXT PRIMARY KEY, "schemaVersion" INTEGER NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL
);
