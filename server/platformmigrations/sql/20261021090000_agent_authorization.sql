-- MCP agent access (RFC 026): a member's consent for an OAuth client, held
-- until its single-use code is exchanged for a scoped workspace API key.
-- Additive; no existing rows change.

-- CreateTable
CREATE TABLE "agent_authorization" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "codeChallenge" TEXT,
    "codeChallengeMethod" TEXT,
    "scopes" JSONB NOT NULL,
    "resource" TEXT,
    "keyExpiresInDays" INTEGER,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "exchangedAt" TIMESTAMP(3),
    "apiKeyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_authorization_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_authorization_codeHash_key" ON "agent_authorization"("codeHash");

-- CreateIndex
CREATE INDEX "agent_authorization_organizationId_createdAt_idx" ON "agent_authorization"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "agent_authorization" ADD CONSTRAINT "agent_authorization_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
