-- Render cache: remember which inputs produced a design's rendered asset, so an
-- unchanged design (or an identical one) reuses the image instead of rendering
-- again. Additive; existing designs simply have no key until their next render.

-- AlterTable
ALTER TABLE "design" ADD COLUMN     "renderKey" TEXT;

-- CreateIndex
CREATE INDEX "design_organizationId_renderKey_idx" ON "design"("organizationId", "renderKey");

