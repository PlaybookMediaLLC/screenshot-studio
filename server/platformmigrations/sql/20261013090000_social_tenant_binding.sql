CREATE TABLE "social_tenant_binding" (
  "organizationId" TEXT NOT NULL,
  "goOrganizationId" TEXT NOT NULL,
  "secretReference" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "social_tenant_binding_pkey" PRIMARY KEY ("organizationId")
);

CREATE UNIQUE INDEX "social_tenant_binding_goOrganizationId_key" ON "social_tenant_binding"("goOrganizationId");
CREATE UNIQUE INDEX "social_tenant_binding_secretReference_key" ON "social_tenant_binding"("secretReference");

ALTER TABLE "social_tenant_binding" ADD CONSTRAINT "social_tenant_binding_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "social_oauth_start" (
  "state" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "secretReference" TEXT NOT NULL,
  "integrationId" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "social_oauth_start_pkey" PRIMARY KEY ("state")
);

CREATE INDEX "social_oauth_start_expiresAt_idx" ON "social_oauth_start"("expiresAt");

ALTER TABLE "social_oauth_start" ADD CONSTRAINT "social_oauth_start_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
