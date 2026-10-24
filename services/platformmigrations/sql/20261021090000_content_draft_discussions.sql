-- Comment threads on a content draft (RFC 013): the threads and the
-- authors' display names, kept with the draft. Additive; existing drafts get {}.
ALTER TABLE "content_draft" ADD COLUMN "discussions" JSONB NOT NULL DEFAULT '{}'::jsonb;
