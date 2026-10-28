-- A schedule request's timing fingerprint, and why a post did not publish.
-- Posts queued before them stay NULL: they replay by draft, channel and
-- version alone, and their reasons remain on their publication attempts.
ALTER TABLE scheduled_post ADD COLUMN "scheduleIntent" text;
ALTER TABLE scheduled_post ADD COLUMN "failureCode" text;
