-- Generated campaign assets: link tenant assets (captures, product shots) to a
-- campaign. Additive; no existing rows change.

-- CreateTable
CREATE TABLE "campaign_asset" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "caption" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_asset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "campaign_asset_organizationId_campaignId_createdAt_idx" ON "campaign_asset"("organizationId", "campaignId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_asset_campaignId_assetId_key" ON "campaign_asset"("campaignId", "assetId");

-- AddForeignKey
ALTER TABLE "campaign_asset" ADD CONSTRAINT "campaign_asset_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_asset" ADD CONSTRAINT "campaign_asset_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_asset" ADD CONSTRAINT "campaign_asset_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

