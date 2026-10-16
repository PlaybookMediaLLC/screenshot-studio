-- Share links publish an exported artifact at an unguessable URL; integration
-- connections hold a workspace's Slack, Notion, and Figma credentials,
-- encrypted by the web facade. Additive; no existing rows change.
CREATE TABLE "share_link" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "assetId" TEXT NOT NULL,
  "posterAssetId" TEXT,
  "projectId" TEXT,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "altText" TEXT,
  "access" TEXT NOT NULL DEFAULT 'PUBLIC',
  "expiresAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "share_link_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "share_link_access_check" CHECK ("access" IN ('PUBLIC', 'WORKSPACE'))
);
CREATE UNIQUE INDEX "share_link_token_key" ON "share_link"("token");
CREATE INDEX "share_link_organizationId_createdAt_idx" ON "share_link"("organizationId", "createdAt");
ALTER TABLE "share_link" ADD CONSTRAINT "share_link_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "share_link" ADD CONSTRAINT "share_link_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "share_link" ADD CONSTRAINT "share_link_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "integration_connection" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "encryptedCredentials" TEXT NOT NULL,
  "scopes" JSONB NOT NULL DEFAULT '[]',
  "tokenExpiresAt" TIMESTAMP(3),
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "integration_connection_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "integration_connection_provider_check" CHECK ("provider" IN ('SLACK', 'NOTION', 'FIGMA'))
);
CREATE UNIQUE INDEX "integration_connection_organizationId_provider_externalId_key"
  ON "integration_connection"("organizationId", "provider", "externalId");
ALTER TABLE "integration_connection" ADD CONSTRAINT "integration_connection_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "integration_connection" ADD CONSTRAINT "integration_connection_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
