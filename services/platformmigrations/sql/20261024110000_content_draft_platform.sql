-- Content drafts, round two (RFC 013): review before scheduling, guest share
-- links, the posting queue, and what a scheduled post carries once live.
ALTER TABLE "content_draft" ADD COLUMN "reviewStatus" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "content_draft" ADD COLUMN "approvedVersion" INTEGER;
ALTER TABLE "content_draft" ADD COLUMN "reviewedByUserId" TEXT;
ALTER TABLE "content_draft" ADD COLUMN "reviewNote" TEXT;
ALTER TABLE "content_draft" ADD COLUMN "shareToken" TEXT;
ALTER TABLE "content_draft" ADD COLUMN "guestComments" JSONB NOT NULL DEFAULT '[]'::jsonb;
CREATE UNIQUE INDEX "content_draft_shareToken_key" ON "content_draft" ("shareToken");

ALTER TABLE "scheduled_post" ADD COLUMN "replyTo" TEXT;
ALTER TABLE "scheduled_post" ADD COLUMN "threadProgress" JSONB;
ALTER TABLE "scheduled_post" ADD COLUMN "remotePostId" TEXT;
ALTER TABLE "scheduled_post" ADD COLUMN "metrics" JSONB;
ALTER TABLE "scheduled_post" ADD COLUMN "metricsAt" TIMESTAMP(3);
ALTER TABLE "scheduled_post" ADD COLUMN "autoActions" JSONB;
ALTER TABLE "scheduled_post" ADD COLUMN "poll" JSONB;

CREATE TABLE "content_draft_settings" (
  "organizationId" TEXT PRIMARY KEY REFERENCES "organization"("id") ON DELETE CASCADE,
  "postingSlots" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "requireApproval" BOOLEAN NOT NULL DEFAULT false,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "content_draft_revision" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "contentDraftId" TEXT NOT NULL REFERENCES "content_draft"("id") ON DELETE CASCADE,
  "version" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "body" JSONB NOT NULL,
  "plainText" TEXT NOT NULL,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "content_draft_revision_contentDraftId_createdAt_idx" ON "content_draft_revision" ("contentDraftId", "createdAt");
