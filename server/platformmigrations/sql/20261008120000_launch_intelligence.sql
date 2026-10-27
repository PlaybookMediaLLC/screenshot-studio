-- Launch intelligence: versioned release specs and campaign plans, AI revision
-- proposals, background launch runs, and provenance on posts, designs, and
-- campaign assets (docs/launch-intelligence.md). Additive; existing rows keep
-- working with the new columns unset.

-- CreateEnum
CREATE TYPE "LaunchArtifactStatus" AS ENUM ('DRAFT', 'APPROVED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "LaunchRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "CampaignRevisionStatus" AS ENUM ('PROPOSED', 'APPLIED', 'DISCARDED');

-- AlterTable
ALTER TABLE "campaign_asset" ADD COLUMN     "planAssetKey" TEXT,
ADD COLUMN     "planVersion" INTEGER,
ADD COLUMN     "variantLabel" TEXT;

-- AlterTable
ALTER TABLE "design" ADD COLUMN     "critique" JSONB,
ADD COLUMN     "planAssetKey" TEXT,
ADD COLUMN     "planVersion" INTEGER,
ADD COLUMN     "variantLabel" TEXT;

-- AlterTable
ALTER TABLE "campaign_post" ADD COLUMN     "claims" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "phase" TEXT,
ADD COLUMN     "planItemKey" TEXT,
ADD COLUMN     "planVersion" INTEGER,
ADD COLUMN     "reviewNote" TEXT,
ADD COLUMN     "specVersion" INTEGER,
ADD COLUMN     "title" TEXT;

-- CreateTable
CREATE TABLE "release_spec" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "LaunchArtifactStatus" NOT NULL DEFAULT 'DRAFT',
    "origin" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "sources" JSONB NOT NULL DEFAULT '[]',
    "changeSummary" TEXT,
    "modelId" TEXT,
    "createdByUserId" TEXT,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "release_spec_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_plan" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "specId" TEXT,
    "version" INTEGER NOT NULL,
    "status" "LaunchArtifactStatus" NOT NULL DEFAULT 'DRAFT',
    "origin" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "changeSummary" TEXT,
    "modelId" TEXT,
    "createdByUserId" TEXT,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_revision" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "targetKey" TEXT,
    "comment" TEXT NOT NULL,
    "status" "CampaignRevisionStatus" NOT NULL DEFAULT 'PROPOSED',
    "proposal" JSONB NOT NULL,
    "modelId" TEXT,
    "createdByUserId" TEXT,
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_revision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "launch_run" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" "LaunchRunStatus" NOT NULL DEFAULT 'RUNNING',
    "resultId" TEXT,
    "summary" TEXT,
    "error" TEXT,
    "createdByUserId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "launch_run_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "release_spec_organizationId_releaseId_createdAt_idx" ON "release_spec"("organizationId", "releaseId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "release_spec_releaseId_version_key" ON "release_spec"("releaseId", "version");

-- CreateIndex
CREATE INDEX "campaign_plan_organizationId_campaignId_createdAt_idx" ON "campaign_plan"("organizationId", "campaignId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_plan_campaignId_version_key" ON "campaign_plan"("campaignId", "version");

-- CreateIndex
CREATE INDEX "campaign_revision_organizationId_campaignId_createdAt_idx" ON "campaign_revision"("organizationId", "campaignId", "createdAt");

-- CreateIndex
CREATE INDEX "campaign_revision_organizationId_status_createdAt_idx" ON "campaign_revision"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "launch_run_organizationId_campaignId_startedAt_idx" ON "launch_run"("organizationId", "campaignId", "startedAt");

-- AddForeignKey
ALTER TABLE "release_spec" ADD CONSTRAINT "release_spec_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "release_spec" ADD CONSTRAINT "release_spec_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "release"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_plan" ADD CONSTRAINT "campaign_plan_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_plan" ADD CONSTRAINT "campaign_plan_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_plan" ADD CONSTRAINT "campaign_plan_specId_fkey" FOREIGN KEY ("specId") REFERENCES "release_spec"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_revision" ADD CONSTRAINT "campaign_revision_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_revision" ADD CONSTRAINT "campaign_revision_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "launch_run" ADD CONSTRAINT "launch_run_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "launch_run" ADD CONSTRAINT "launch_run_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

