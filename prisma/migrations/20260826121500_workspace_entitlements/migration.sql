CREATE TABLE "workspace_entitlement" (
    "organizationId" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "status" TEXT NOT NULL DEFAULT 'active',
    "featureOverrides" JSONB,
    "validUntil" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_entitlement_pkey" PRIMARY KEY ("organizationId")
);

CREATE INDEX "workspace_entitlement_plan_status_idx" ON "workspace_entitlement"("plan", "status");
CREATE INDEX "workspace_entitlement_status_validUntil_idx" ON "workspace_entitlement"("status", "validUntil");

ALTER TABLE "workspace_entitlement" ADD CONSTRAINT "workspace_entitlement_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve capabilities for workspaces that existed before commercial
-- entitlement enforcement. New workspaces without a provisioned record use
-- the application's conservative free-plan fallback.
INSERT INTO "workspace_entitlement" (
    "organizationId",
    "plan",
    "status",
    "createdAt",
    "updatedAt"
)
SELECT
    "id",
    'business',
    'active',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "organization"
ON CONFLICT ("organizationId") DO NOTHING;
