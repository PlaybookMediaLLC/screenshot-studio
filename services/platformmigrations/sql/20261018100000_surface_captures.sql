-- Product surfaces gain a stable slug and capture freshness, and captures
-- become rows (docs/rfcs/013-product-asset-map.md).
ALTER TABLE "product_surface" ADD COLUMN "slug" TEXT;
ALTER TABLE "product_surface" ADD COLUMN "lastCapturedAt" TIMESTAMP(3);
ALTER TABLE "product_surface" ADD COLUMN "lastCaptureFailureCode" TEXT;

-- The slug comes from the name. Two names with one slug ("Billing!" and
-- "Billing?") keep it once; the others are made unique with their id.
WITH slugs AS (
    SELECT id, COALESCE(NULLIF(left(trim(BOTH '-' FROM regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g')), 64), ''), 'surface') AS slug,
        row_number() OVER (
            PARTITION BY "organizationId", COALESCE(NULLIF(left(trim(BOTH '-' FROM regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g')), 64), ''), 'surface')
            ORDER BY "createdAt", id) AS position
    FROM "product_surface"
)
UPDATE "product_surface" AS surface
SET "slug" = CASE WHEN slugs.position = 1 THEN slugs.slug ELSE slugs.slug || '-' || surface.id END
FROM slugs WHERE surface.id = slugs.id;

ALTER TABLE "product_surface" ALTER COLUMN "slug" SET NOT NULL;
CREATE UNIQUE INDEX "product_surface_organizationId_slug_key" ON "product_surface"("organizationId", "slug");

CREATE TYPE "SurfaceCaptureSource" AS ENUM ('deployment', 'agent', 'release', 'manual');

CREATE TABLE "surface_capture" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "surfaceId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "source" "SurfaceCaptureSource" NOT NULL,
    "sourceId" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMP(3),

    CONSTRAINT "surface_capture_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "surface_capture_surfaceId_capturedAt_idx" ON "surface_capture"("surfaceId", "capturedAt" DESC);
CREATE INDEX "surface_capture_organizationId_capturedAt_idx" ON "surface_capture"("organizationId", "capturedAt");
-- At most one current capture per surface.
CREATE UNIQUE INDEX "surface_capture_surfaceId_current_key" ON "surface_capture"("surfaceId") WHERE "supersededAt" IS NULL;
ALTER TABLE "surface_capture" ADD CONSTRAINT "surface_capture_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "surface_capture" ADD CONSTRAINT "surface_capture_surfaceId_fkey"
    FOREIGN KEY ("surfaceId") REFERENCES "product_surface"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "surface_capture" ADD CONSTRAINT "surface_capture_assetId_fkey"
    FOREIGN KEY ("assetId") REFERENCES "asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The newest screenshot of each surface becomes its current capture; the
-- JSON column stays as a compatibility copy.
INSERT INTO "surface_capture" ("id", "organizationId", "surfaceId", "assetId", "source", "capturedAt")
SELECT 'sc_' || surface.id, surface."organizationId", surface.id, asset.id, 'manual', asset."createdAt"
FROM "product_surface" AS surface
JOIN LATERAL (
    SELECT a.id, a."createdAt" FROM jsonb_array_elements_text(surface."screenshotAssetIds") WITH ORDINALITY AS ids(value, position)
    JOIN "asset" AS a ON a.id = ids.value AND a."organizationId" = surface."organizationId" AND a.status = 'UPLOADED'
    ORDER BY ids.position DESC LIMIT 1
) AS asset ON true;
UPDATE "product_surface" AS surface SET "lastCapturedAt" = capture."capturedAt"
FROM "surface_capture" AS capture WHERE capture."surfaceId" = surface.id;
