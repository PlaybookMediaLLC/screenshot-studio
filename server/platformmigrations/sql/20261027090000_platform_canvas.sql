-- Canvas workspaces (RFC 032) share platform_creative_set's revisions, versions
-- and retention. A row's kind is fixed at creation. Additive: existing rows are
-- Story Sets.
ALTER TABLE "platform_creative_set" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'story-set';
ALTER TABLE "platform_creative_set" ADD CONSTRAINT "platform_creative_set_kind_check" CHECK ("kind" IN ('story-set', 'canvas'));
CREATE INDEX "platform_creative_set_organizationId_kind_updatedAt_idx" ON "platform_creative_set"("organizationId", "kind", "updatedAt");
