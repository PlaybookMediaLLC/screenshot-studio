-- A GitHub App installation is a platform record; any number of workspaces may
-- link to it, and each picks its own repositories as sources.
CREATE TABLE "github_installation" (
  "id" TEXT NOT NULL,
  "installationId" BIGINT NOT NULL,
  "accountLogin" TEXT NOT NULL,
  "accountType" TEXT NOT NULL,
  "repositorySelection" TEXT NOT NULL DEFAULT 'selected',
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "github_installation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "github_installation_installationId_key" ON "github_installation"("installationId");

CREATE TABLE "workspace_github_installation" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "githubInstallationId" TEXT NOT NULL,
  "connectedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "workspace_github_installation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "workspace_github_installation_org_installation_key"
  ON "workspace_github_installation"("organizationId", "githubInstallationId");
ALTER TABLE "workspace_github_installation" ADD CONSTRAINT "workspace_github_installation_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workspace_github_installation" ADD CONSTRAINT "workspace_github_installation_githubInstallationId_fkey"
  FOREIGN KEY ("githubInstallationId") REFERENCES "github_installation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A single-use grant tying a GitHub install to the user, session, and workspace that began it.
CREATE TABLE "github_install_start" (
  "state" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "github_install_start_pkey" PRIMARY KEY ("state")
);
CREATE INDEX "github_install_start_expiresAt_idx" ON "github_install_start"("expiresAt");
ALTER TABLE "github_install_start" ADD CONSTRAINT "github_install_start_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Several workspaces may watch the same repository; each only once.
ALTER TABLE "source_app" ADD COLUMN IF NOT EXISTS "githubInstallationId" TEXT;
ALTER TABLE "source_app" ADD CONSTRAINT "source_app_githubInstallationId_fkey"
  FOREIGN KEY ("githubInstallationId") REFERENCES "github_installation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
DROP INDEX IF EXISTS "source_app_provider_externalId_key";
CREATE UNIQUE INDEX "source_app_organizationId_provider_externalId_key"
  ON "source_app"("organizationId", "provider", "externalId");
CREATE INDEX "source_app_provider_externalId_idx" ON "source_app"("provider", "externalId");

-- A merged pull request held until the source's next published release.
CREATE TABLE "source_change" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "sourceAppId" TEXT NOT NULL,
  "repositoryId" TEXT NOT NULL,
  "number" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL DEFAULT '',
  "url" TEXT NOT NULL,
  "authorLogin" TEXT,
  "labels" JSONB NOT NULL DEFAULT '[]',
  "files" JSONB NOT NULL DEFAULT '[]',
  "imageUrls" JSONB NOT NULL DEFAULT '[]',
  "mergedAt" TIMESTAMP(3) NOT NULL,
  "releaseId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "source_change_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "source_change_source_repository_number_key"
  ON "source_change"("sourceAppId", "repositoryId", "number");
CREATE INDEX "source_change_organizationId_sourceAppId_releaseId_idx"
  ON "source_change"("organizationId", "sourceAppId", "releaseId");
ALTER TABLE "source_change" ADD CONSTRAINT "source_change_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "source_change" ADD CONSTRAINT "source_change_sourceAppId_fkey"
  FOREIGN KEY ("sourceAppId") REFERENCES "source_app"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "source_change" ADD CONSTRAINT "source_change_releaseId_fkey"
  FOREIGN KEY ("releaseId") REFERENCES "release"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- What a release says in full, the features read from it, and the screenshots found in it.
ALTER TABLE "release" ADD COLUMN IF NOT EXISTS "notes" TEXT;
ALTER TABLE "release" ADD COLUMN IF NOT EXISTS "features" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "release" ADD COLUMN IF NOT EXISTS "screenshotAssetIds" JSONB NOT NULL DEFAULT '[]';

-- A successful production deployment, and the product screenshots it triggered.
CREATE TABLE "deployment_event" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "sourceAppId" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "environment" TEXT NOT NULL,
  "url" TEXT,
  "sha" TEXT,
  "status" TEXT NOT NULL DEFAULT 'RECEIVED',
  "failureCode" TEXT,
  "assetIds" JSONB NOT NULL DEFAULT '[]',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "deployment_event_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "deployment_event_source_external_key" ON "deployment_event"("sourceAppId", "externalId");
CREATE INDEX "deployment_event_organizationId_createdAt_idx" ON "deployment_event"("organizationId", "createdAt");
ALTER TABLE "deployment_event" ADD CONSTRAINT "deployment_event_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "deployment_event" ADD CONSTRAINT "deployment_event_sourceAppId_fkey"
  FOREIGN KEY ("sourceAppId") REFERENCES "source_app"("id") ON DELETE CASCADE ON UPDATE CASCADE;
