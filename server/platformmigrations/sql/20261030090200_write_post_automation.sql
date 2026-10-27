-- RFC 025: receipts of a live post's follow-ups. One row per post and step,
-- so a retried step never posts twice and cancelling stops pending ones.
CREATE TABLE "post_automation_run" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "scheduledPostId" TEXT NOT NULL REFERENCES "scheduled_post"("id") ON DELETE CASCADE,
  "key" TEXT NOT NULL,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('first_comment', 'retweet', 'unretweet', 'plug', 'repost_at_likes', 'quote')),
  "status" TEXT NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'done', 'failed', 'skipped', 'cancelled', 'expired')),
  "dueAt" TIMESTAMP(3) NOT NULL,
  "remoteId" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "failureCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "post_automation_run_scheduledPostId_key_key" ON "post_automation_run" ("scheduledPostId", "key");
