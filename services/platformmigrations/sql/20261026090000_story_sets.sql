-- Cloud platform_creative_sets: editor compositions a workspace keeps working on, with
-- revision-checked writes and a version history. Additive; no existing rows change.
CREATE TABLE "platform_creative_set" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "document" JSONB NOT NULL,
  "documentVersion" INTEGER NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "archived" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "platform_creative_set_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "platform_creative_set_revision_check" CHECK ("revision" >= 1)
);
CREATE INDEX "platform_creative_set_organizationId_updatedAt_idx" ON "platform_creative_set"("organizationId", "updatedAt");
ALTER TABLE "platform_creative_set" ADD CONSTRAINT "platform_creative_set_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "platform_creative_set" ADD CONSTRAINT "platform_creative_set_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "platform_creative_set" ADD CONSTRAINT "platform_creative_set_updatedByUserId_fkey"
  FOREIGN KEY ("updatedByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "platform_creative_set_version" (
  "id" TEXT NOT NULL,
  "creativeSetId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "kind" TEXT NOT NULL,
  "name" TEXT,
  "document" JSONB NOT NULL,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "platform_creative_set_version_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "platform_creative_set_version_kind_check" CHECK ("kind" IN ('autosave', 'named', 'restore', 'duplicate'))
);
CREATE INDEX "platform_creative_set_version_creativeSetId_createdAt_idx" ON "platform_creative_set_version"("creativeSetId", "createdAt");
ALTER TABLE "platform_creative_set_version" ADD CONSTRAINT "platform_creative_set_version_creativeSetId_fkey"
  FOREIGN KEY ("creativeSetId") REFERENCES "platform_creative_set"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "platform_creative_set_version" ADD CONSTRAINT "platform_creative_set_version_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "platform_creative_set_version" ADD CONSTRAINT "platform_creative_set_version_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "platform_creative_set" ADD CONSTRAINT "platform_creative_set_id_org_key" UNIQUE ("id", "organizationId");
ALTER TABLE "platform_creative_set_version" ADD CONSTRAINT "platform_creative_set_version_owner_fkey" FOREIGN KEY ("creativeSetId", "organizationId") REFERENCES "platform_creative_set"("id", "organizationId") ON DELETE CASCADE;
