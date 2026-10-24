-- A content draft post publishes several images (RFC 013). assetId stays the
-- first, with its foreign key; posts from before this column have only that.
ALTER TABLE "scheduled_post" ADD COLUMN "assetIds" JSONB;
