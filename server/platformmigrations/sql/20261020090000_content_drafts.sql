-- Content drafts (RFC 013): posts written by hand in the document editor,
-- kept as drafts and scheduled to channels. Additive; no existing rows change.
CREATE TABLE "content_draft" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" JSONB NOT NULL,
  "plainText" TEXT NOT NULL,
  "assetIds" JSONB NOT NULL,
  "channelConnectionIds" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "version" INTEGER NOT NULL DEFAULT 1,
  "collabState" BYTEA,
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "content_draft_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "content_draft_status_check" CHECK ("status" IN ('draft', 'scheduled', 'archived')),
  CONSTRAINT "content_draft_version_check" CHECK ("version" >= 1)
);
CREATE INDEX "content_draft_organizationId_updatedAt_idx" ON "content_draft"("organizationId", "updatedAt");
ALTER TABLE "content_draft" ADD CONSTRAINT "content_draft_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "content_draft" ADD CONSTRAINT "content_draft_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "content_draft" ADD CONSTRAINT "content_draft_updatedByUserId_fkey"
  FOREIGN KEY ("updatedByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
