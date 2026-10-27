-- A client Idempotency-Key on campaign creation: a retried create returns the
-- campaign the first request made. Additive; existing rows keep NULL.

-- AlterTable
ALTER TABLE "campaign" ADD COLUMN "idempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "campaign_organizationId_idempotencyKey_key" ON "campaign"("organizationId", "idempotencyKey");
