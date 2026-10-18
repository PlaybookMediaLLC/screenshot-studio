-- A scheduled post comes from a creative variant or a content draft, never
-- both and never neither (RFC 037). Existing rows all have a variant, so the
-- check holds for them. A draft post carries its own media asset.
ALTER TABLE "scheduled_post" ALTER COLUMN "variantId" DROP NOT NULL;
ALTER TABLE "scheduled_post" ADD COLUMN "contentDraftId" TEXT;
ALTER TABLE "scheduled_post" ADD COLUMN "assetId" TEXT;
ALTER TABLE "scheduled_post" ADD CONSTRAINT "scheduled_post_source_check"
  CHECK (("variantId" IS NULL) <> ("contentDraftId" IS NULL));
ALTER TABLE "scheduled_post" ADD CONSTRAINT "scheduled_post_contentDraftId_fkey"
  FOREIGN KEY ("contentDraftId") REFERENCES "content_draft"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "scheduled_post" ADD CONSTRAINT "scheduled_post_assetId_fkey"
  FOREIGN KEY ("assetId") REFERENCES "asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "scheduled_post_contentDraftId_idx" ON "scheduled_post"("contentDraftId");
