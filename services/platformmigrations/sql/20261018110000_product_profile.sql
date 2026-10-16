-- One product profile per workspace, with per-field provenance
-- (docs/rfcs/012-product-intelligence.md).
CREATE TABLE "product_profile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "problem" TEXT NOT NULL DEFAULT '',
    "audience" TEXT NOT NULL DEFAULT '',
    "capabilities" JSONB NOT NULL DEFAULT '[]',
    "proofPoints" JSONB NOT NULL DEFAULT '[]',
    "pricingNote" TEXT NOT NULL DEFAULT '',
    "competitors" JSONB NOT NULL DEFAULT '[]',
    "provenance" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_profile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "product_profile_organizationId_key" ON "product_profile"("organizationId");
ALTER TABLE "product_profile" ADD CONSTRAINT "product_profile_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
