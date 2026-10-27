-- Purchased AI credit packs, drawn after the monthly allowance (RFC 023).
CREATE TABLE "workspace_credit_grant" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "remaining" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_credit_grant_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "workspace_credit_grant_remaining_check" CHECK ("remaining" >= 0 AND "remaining" <= "credits")
);

CREATE UNIQUE INDEX "workspace_credit_grant_provider_reference_key"
ON "workspace_credit_grant"("provider", "reference");
CREATE INDEX "workspace_credit_grant_organizationId_createdAt_idx"
ON "workspace_credit_grant"("organizationId", "createdAt");

ALTER TABLE "workspace_credit_grant"
ADD CONSTRAINT "workspace_credit_grant_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
