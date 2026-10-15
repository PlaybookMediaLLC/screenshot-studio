-- Design documents: AI- and user-authored editor compositions, their variants,
-- and their latest render. Additive; no existing rows change.

-- CreateTable
CREATE TABLE "design" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campaignId" TEXT,
    "parentDesignId" TEXT,
    "name" TEXT NOT NULL,
    "templateId" TEXT,
    "document" JSONB NOT NULL,
    "renderedAssetId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "design_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "design_organizationId_campaignId_createdAt_idx" ON "design"("organizationId", "campaignId", "createdAt");

-- AddForeignKey
ALTER TABLE "design" ADD CONSTRAINT "design_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design" ADD CONSTRAINT "design_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design" ADD CONSTRAINT "design_parentDesignId_fkey" FOREIGN KEY ("parentDesignId") REFERENCES "design"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design" ADD CONSTRAINT "design_renderedAssetId_fkey" FOREIGN KEY ("renderedAssetId") REFERENCES "asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design" ADD CONSTRAINT "design_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

