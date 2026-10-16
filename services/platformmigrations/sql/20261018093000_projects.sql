-- Cloud projects: editor compositions a workspace keeps working on, with
-- revision-checked writes and a version history. Additive; no existing rows change.
CREATE TABLE "project" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "document" JSONB NOT NULL,
  "documentVersion" INTEGER NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "project_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "project_revision_check" CHECK ("revision" >= 1)
);
CREATE INDEX "project_organizationId_updatedAt_idx" ON "project"("organizationId", "updatedAt");
ALTER TABLE "project" ADD CONSTRAINT "project_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project" ADD CONSTRAINT "project_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "project" ADD CONSTRAINT "project_updatedByUserId_fkey"
  FOREIGN KEY ("updatedByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "project_version" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "kind" TEXT NOT NULL,
  "name" TEXT,
  "document" JSONB NOT NULL,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "project_version_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "project_version_kind_check" CHECK ("kind" IN ('autosave', 'named', 'restore', 'duplicate'))
);
CREATE INDEX "project_version_projectId_createdAt_idx" ON "project_version"("projectId", "createdAt");
ALTER TABLE "project_version" ADD CONSTRAINT "project_version_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_version" ADD CONSTRAINT "project_version_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_version" ADD CONSTRAINT "project_version_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
