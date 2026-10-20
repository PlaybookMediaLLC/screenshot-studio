-- Write (RFC 042): social sets, set-scoped tags and thread finishers, and the
-- draft's kind, target, platform versions, internal notes, pin and plan.
-- Additive only: a draft without a set belongs to the workspace's default set.
CREATE TABLE "social_set" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "color" TEXT NOT NULL DEFAULT 'sky',
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "channelConnectionIds" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "defaultChannels" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "timeZone" TEXT,
  "visibility" TEXT NOT NULL DEFAULT 'workspace' CHECK ("visibility" IN ('workspace', 'restricted')),
  "memberUserIds" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "preferences" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "createdByUserId" TEXT REFERENCES "user"("id") ON DELETE SET NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "social_set_organizationId_createdAt_idx" ON "social_set" ("organizationId", "createdAt");
-- One default set per workspace, so two first visits cannot make two.
CREATE UNIQUE INDEX "social_set_default_key" ON "social_set" ("organizationId") WHERE "isDefault";

CREATE TABLE "content_draft_tag" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "socialSetId" TEXT NOT NULL REFERENCES "social_set"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "color" TEXT NOT NULL DEFAULT 'gray',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "content_draft_tag_socialSetId_createdAt_idx" ON "content_draft_tag" ("socialSetId", "createdAt");
CREATE UNIQUE INDEX "content_draft_tag_socialSetId_name_key" ON "content_draft_tag" ("socialSetId", lower("name"));

CREATE TABLE "content_draft_finisher" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "socialSetId" TEXT NOT NULL REFERENCES "social_set"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "quoteFirstPost" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "content_draft_finisher_socialSetId_createdAt_idx" ON "content_draft_finisher" ("socialSetId", "createdAt");

-- A set with drafts cannot be deleted out from under them; NO ACTION is checked
-- at the end of the statement, so deleting a workspace still cascades.
ALTER TABLE "content_draft" ADD COLUMN "socialSetId" TEXT REFERENCES "social_set"("id");
ALTER TABLE "content_draft" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'standard'
  CHECK ("kind" IN ('standard', 'reply', 'quote', 'repurpose', 'article'));
ALTER TABLE "content_draft" ADD COLUMN "target" JSONB;
ALTER TABLE "content_draft" ADD COLUMN "primaryChannel" TEXT NOT NULL DEFAULT 'x';
ALTER TABLE "content_draft" ADD COLUMN "platformVersions" JSONB NOT NULL DEFAULT '{"schemaVersion":1,"versions":[]}'::jsonb;
ALTER TABLE "content_draft" ADD COLUMN "article" JSONB;
ALTER TABLE "content_draft" ADD COLUMN "scratchpad" TEXT NOT NULL DEFAULT '';
ALTER TABLE "content_draft" ADD COLUMN "tagIds" JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "content_draft" ADD COLUMN "pinnedAt" TIMESTAMP(3);
ALTER TABLE "content_draft" ADD COLUMN "plannedFor" TIMESTAMP(3);
ALTER TABLE "content_draft" ADD COLUMN "planTimeZone" TEXT;
ALTER TABLE "content_draft" ADD COLUMN "sourceDraftId" TEXT REFERENCES "content_draft"("id") ON DELETE SET NULL;
CREATE INDEX "content_draft_organizationId_socialSetId_updatedAt_idx" ON "content_draft" ("organizationId", "socialSetId", "updatedAt");
CREATE INDEX "content_draft_organizationId_plannedFor_idx" ON "content_draft" ("organizationId", "plannedFor") WHERE "plannedFor" IS NOT NULL;

ALTER TABLE "content_draft_revision" ADD COLUMN "platformVersions" JSONB;
ALTER TABLE "content_draft_revision" ADD COLUMN "article" JSONB;
ALTER TABLE "content_draft_revision" ADD COLUMN "reason" TEXT NOT NULL DEFAULT 'edit';

-- A draft's activity timeline reads its audit history by entity.
CREATE INDEX "audit_log_organizationId_entityType_entityId_createdAt_idx" ON "audit_log" ("organizationId", "entityType", "entityId", "createdAt");
