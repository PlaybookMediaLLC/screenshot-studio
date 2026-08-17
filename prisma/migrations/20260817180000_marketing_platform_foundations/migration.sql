-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'READY_FOR_REVIEW', 'APPROVED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CampaignPostStatus" AS ENUM ('DRAFT', 'READY_FOR_REVIEW', 'APPROVED', 'REJECTED', 'NEEDS_CHANGES', 'SCHEDULED', 'PUBLISHED');

-- CreateTable
CREATE TABLE "brand_profile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productDescription" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "tone" TEXT NOT NULL,
    "tagline" TEXT,
    "ctaConventions" TEXT,
    "prohibitedTerms" JSONB NOT NULL,
    "preferredStyles" JSONB NOT NULL,
    "socialHandles" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brand_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_surface" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "description" TEXT,
    "featureTags" JSONB NOT NULL,
    "screenshotAssetIds" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_surface_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "audience" TEXT,
    "feature" TEXT,
    "messaging" TEXT,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_angle" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "hook" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_angle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_post" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "angleId" TEXT,
    "channel" TEXT NOT NULL,
    "copy" TEXT NOT NULL,
    "callToAction" TEXT,
    "status" "CampaignPostStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduledAt" TIMESTAMP(3),
    "creativeVariantId" TEXT,
    "scheduledPostId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_post_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "brand_profile_organizationId_key" ON "brand_profile"("organizationId");

-- CreateIndex
CREATE INDEX "product_surface_organizationId_createdAt_idx" ON "product_surface"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "product_surface_organizationId_name_key" ON "product_surface"("organizationId", "name");

-- CreateIndex
CREATE INDEX "campaign_organizationId_createdAt_idx" ON "campaign"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "content_angle_organizationId_createdAt_idx" ON "content_angle"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "content_angle_campaignId_position_key" ON "content_angle"("campaignId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_post_scheduledPostId_key" ON "campaign_post"("scheduledPostId");

-- CreateIndex
CREATE INDEX "campaign_post_organizationId_status_idx" ON "campaign_post"("organizationId", "status");

-- CreateIndex
CREATE INDEX "campaign_post_campaignId_idx" ON "campaign_post"("campaignId");

-- AddForeignKey
ALTER TABLE "brand_profile" ADD CONSTRAINT "brand_profile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_surface" ADD CONSTRAINT "product_surface_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_angle" ADD CONSTRAINT "content_angle_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_angle" ADD CONSTRAINT "content_angle_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_post" ADD CONSTRAINT "campaign_post_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_post" ADD CONSTRAINT "campaign_post_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_post" ADD CONSTRAINT "campaign_post_angleId_fkey" FOREIGN KEY ("angleId") REFERENCES "content_angle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_post" ADD CONSTRAINT "campaign_post_creativeVariantId_fkey" FOREIGN KEY ("creativeVariantId") REFERENCES "creative_variant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_post" ADD CONSTRAINT "campaign_post_scheduledPostId_fkey" FOREIGN KEY ("scheduledPostId") REFERENCES "scheduled_post"("id") ON DELETE SET NULL ON UPDATE CASCADE;

