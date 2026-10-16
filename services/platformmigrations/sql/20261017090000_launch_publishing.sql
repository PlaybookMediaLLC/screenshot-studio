-- An approved design render becomes a creative variant, and a campaign post
-- records who approved it and when (Phase 0, steps 2 and 3).
ALTER TABLE "creative_variant"
    ALTER COLUMN "brandKitId" DROP NOT NULL,
    ALTER COLUMN "brandKitVersion" DROP NOT NULL,
    ALTER COLUMN "templateId" DROP NOT NULL,
    ALTER COLUMN "templateVersion" DROP NOT NULL,
    ADD COLUMN "designId" TEXT;

ALTER TABLE "creative_variant"
ADD CONSTRAINT "creative_variant_designId_fkey"
FOREIGN KEY ("designId") REFERENCES "design"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A variant comes from a design render or from a versioned brand kit and template.
ALTER TABLE "creative_variant"
ADD CONSTRAINT "creative_variant_source_check"
CHECK ("designId" IS NOT NULL OR num_nulls("brandKitId", "brandKitVersion", "templateId", "templateVersion") = 0);

CREATE UNIQUE INDEX "creative_variant_designId_sourceAssetId_key"
ON "creative_variant"("designId", "sourceAssetId");

ALTER TABLE "campaign_post"
    ADD COLUMN "approvedByUserId" TEXT,
    ADD COLUMN "approvedAt" TIMESTAMP(3);

ALTER TABLE "campaign_post"
ADD CONSTRAINT "campaign_post_approvedByUserId_fkey"
FOREIGN KEY ("approvedByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE "campaign_post" SET "approvedAt" = "updatedAt" WHERE "status" IN ('APPROVED', 'SCHEDULED');
