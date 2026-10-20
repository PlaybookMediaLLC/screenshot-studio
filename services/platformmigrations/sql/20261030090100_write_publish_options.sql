-- Write (RFC 042): a draft post's settings beyond its text, snapshotted when
-- it is scheduled, like its caption. Replies keep theirs inside "replies".
ALTER TABLE "scheduled_post" ADD COLUMN "publishOptions" JSONB;
