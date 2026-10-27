-- Week 1 product connection: anchor releases and campaigns to product surfaces.
-- Every change is additive and nullable or defaulted, so existing rows stay valid
-- and no backfill runs. Contextual links use SET NULL so campaign and release
-- history survives the deletion of a surface or release.

-- AlterTable
ALTER TABLE "release" ADD COLUMN     "audience" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "productSurfaceId" TEXT,
ADD COLUMN     "sourceUrls" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "product_surface" ADD COLUMN     "environment" TEXT NOT NULL DEFAULT 'production';

-- AlterTable
ALTER TABLE "campaign" ADD COLUMN     "createdByUserId" TEXT,
ADD COLUMN     "productSurfaceId" TEXT,
ADD COLUMN     "releaseId" TEXT;

-- CreateIndex
CREATE INDEX "release_organizationId_productSurfaceId_idx" ON "release"("organizationId", "productSurfaceId");

-- CreateIndex
CREATE INDEX "campaign_organizationId_releaseId_idx" ON "campaign"("organizationId", "releaseId");

-- CreateIndex
CREATE INDEX "campaign_organizationId_productSurfaceId_idx" ON "campaign"("organizationId", "productSurfaceId");

-- AddForeignKey
ALTER TABLE "release" ADD CONSTRAINT "release_productSurfaceId_fkey" FOREIGN KEY ("productSurfaceId") REFERENCES "product_surface"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "release"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_productSurfaceId_fkey" FOREIGN KEY ("productSurfaceId") REFERENCES "product_surface"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

