-- Store screenshot studio: shareable review snapshots with slide comments,
-- and encrypted store publishing credentials. Additive; no existing rows change.

-- CreateEnum
CREATE TYPE "StorePublishingProvider" AS ENUM ('APP_STORE_CONNECT', 'GOOGLE_PLAY');

-- CreateTable
CREATE TABLE "store_review" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "versionLabel" TEXT NOT NULL,
    "projectRevision" INTEGER NOT NULL,
    "shareTokenId" TEXT NOT NULL,
    "slides" JSONB NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_review_comment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "slideId" TEXT NOT NULL,
    "x" DOUBLE PRECISION,
    "y" DOUBLE PRECISION,
    "authorName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "fromLink" BOOLEAN NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_review_comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_publishing_credential" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" "StorePublishingProvider" NOT NULL,
    "label" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "encryptedSecret" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_publishing_credential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "store_review_organizationId_projectId_createdAt_idx" ON "store_review"("organizationId", "projectId", "createdAt");

-- CreateIndex
CREATE INDEX "store_review_comment_organizationId_reviewId_createdAt_idx" ON "store_review_comment"("organizationId", "reviewId", "createdAt");

-- CreateIndex
CREATE INDEX "store_publishing_credential_organizationId_provider_idx" ON "store_publishing_credential"("organizationId", "provider");

-- AddForeignKey
ALTER TABLE "store_review" ADD CONSTRAINT "store_review_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_review" ADD CONSTRAINT "store_review_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_review_comment" ADD CONSTRAINT "store_review_comment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_review_comment" ADD CONSTRAINT "store_review_comment_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "store_review"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_review_comment" ADD CONSTRAINT "store_review_comment_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_publishing_credential" ADD CONSTRAINT "store_publishing_credential_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_publishing_credential" ADD CONSTRAINT "store_publishing_credential_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
