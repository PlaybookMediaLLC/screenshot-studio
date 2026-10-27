-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('USER', 'SERVICE', 'SUPPORT', 'WEBHOOK');

-- CreateEnum
CREATE TYPE "AuditOutcome" AS ENUM ('SUCCEEDED', 'FAILED', 'DENIED');

-- CreateEnum
CREATE TYPE "AuditDrainProvider" AS ENUM ('GENERIC', 'SPLUNK', 'DATADOG');

-- CreateEnum
CREATE TYPE "AuditDrainDeliveryStatus" AS ENUM ('PENDING', 'PROCESSING', 'DELIVERED', 'FAILED');

-- CreateEnum
CREATE TYPE "VersionedResourceStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ReleaseStatus" AS ENUM ('DRAFT', 'READY', 'ARCHIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReleaseDocumentStatus" AS ENUM ('DRAFT', 'APPROVED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CustomerCommunicationChannel" AS ENUM ('CHANGELOG', 'IN_APP', 'EMAIL', 'SOCIAL');

-- CreateEnum
CREATE TYPE "CustomerCommunicationStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PROCESSING', 'DELIVERED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ExecutionStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('PENDING', 'UPLOADED', 'FAILED', 'DELETED');

-- CreateEnum
CREATE TYPE "VariantStatus" AS ENUM ('DRAFT', 'APPROVED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('ACTIVE', 'DISABLED', 'REVOKED');

-- CreateEnum
CREATE TYPE "ScheduledPostStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PROCESSING', 'PUBLISHED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AttemptOutcome" AS ENUM ('SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "twoFactorEnabled" BOOLEAN DEFAULT false,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,
    "activeOrganizationId" TEXT,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "metadata" TEXT,

    CONSTRAINT "organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "inviterId" TEXT NOT NULL,

    CONSTRAINT "invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "apikey" (
    "id" TEXT NOT NULL,
    "configId" TEXT NOT NULL DEFAULT 'default',
    "name" TEXT,
    "start" TEXT,
    "referenceId" TEXT NOT NULL,
    "prefix" TEXT,
    "key" TEXT NOT NULL,
    "refillInterval" INTEGER,
    "refillAmount" INTEGER,
    "lastRefillAt" TIMESTAMP(3),
    "enabled" BOOLEAN DEFAULT true,
    "rateLimitEnabled" BOOLEAN DEFAULT true,
    "rateLimitTimeWindow" INTEGER DEFAULT 60000,
    "rateLimitMax" INTEGER DEFAULT 60,
    "requestCount" INTEGER DEFAULT 0,
    "remaining" INTEGER,
    "lastRequest" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "permissions" TEXT,
    "metadata" TEXT,

    CONSTRAINT "apikey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "twoFactor" (
    "id" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "backupCodes" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "verified" BOOLEAN DEFAULT true,
    "failedVerificationCount" INTEGER DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),

    CONSTRAINT "twoFactor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ssoProvider" (
    "id" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "oidcConfig" TEXT,
    "samlConfig" TEXT,
    "userId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "organizationId" TEXT,
    "domain" TEXT NOT NULL,
    "domainVerified" BOOLEAN,

    CONSTRAINT "ssoProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scimProvider" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "scimToken" TEXT NOT NULL,
    "organizationId" TEXT,
    "userId" TEXT,

    CONSTRAINT "scimProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_enterprise_settings" (
    "organizationId" TEXT NOT NULL,
    "ssoEnabled" BOOLEAN NOT NULL DEFAULT false,
    "scimEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_enterprise_settings_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestId" TEXT NOT NULL,
    "actorType" "AuditActorType" NOT NULL,
    "actorUserId" TEXT,
    "actorDisplay" TEXT,
    "action" TEXT NOT NULL,
    "outcome" "AuditOutcome" NOT NULL DEFAULT 'SUCCEEDED',
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "ipHash" TEXT,
    "userAgentSummary" TEXT,
    "metadata" JSONB,
    "searchText" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_retention_policy" (
    "organizationId" TEXT NOT NULL,
    "retentionDays" INTEGER NOT NULL DEFAULT 90,
    "legalHold" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "audit_retention_policy_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "audit_drain" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" "AuditDrainProvider" NOT NULL DEFAULT 'GENERIC',
    "endpoint" TEXT NOT NULL,
    "encryptedSigningSecret" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "audit_drain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_outbox" (
    "id" TEXT NOT NULL,
    "auditLogId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_drain_delivery" (
    "id" TEXT NOT NULL,
    "drainId" TEXT NOT NULL,
    "outboxId" TEXT NOT NULL,
    "status" "AuditDrainDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "responseCode" INTEGER,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "audit_drain_delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_access_grant" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'metadata:read',
    "requestedByUserId" TEXT,
    "approvedByUserId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_access_grant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "screenshot_cache" (
    "id" TEXT NOT NULL,
    "urlHash" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "cloudinaryPublicId" TEXT NOT NULL,
    "cloudinaryUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "screenshot_cache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brand_kit" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "definition" JSONB NOT NULL,
    "status" "VersionedResourceStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brand_kit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_app" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'generic',
    "externalId" TEXT,
    "secretReference" TEXT,
    "allowedHosts" JSONB NOT NULL,
    "status" "VersionedResourceStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "source_app_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "capture_recipe" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourceAppId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "definition" JSONB NOT NULL,
    "secretReference" TEXT,
    "status" "VersionedResourceStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "capture_recipe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creative_template" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "definition" JSONB NOT NULL,
    "status" "VersionedResourceStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "creative_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "release" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "benefitStatement" TEXT NOT NULL,
    "status" "ReleaseStatus" NOT NULL DEFAULT 'DRAFT',
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "release_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "release_document" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "frontMatter" JSONB NOT NULL,
    "bodyMarkdown" TEXT NOT NULL,
    "status" "ReleaseDocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "release_document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_communication" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "releaseDocumentId" TEXT NOT NULL,
    "channel" "CustomerCommunicationChannel" NOT NULL,
    "audienceReference" TEXT,
    "status" "CustomerCommunicationStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduledFor" TIMESTAMP(3),
    "ctaUrl" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "triggerRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_communication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_attempt" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerCommunicationId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "outcome" "AttemptOutcome",
    "providerMessageId" TEXT,
    "failureCode" TEXT,

    CONSTRAINT "communication_attempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "capture_job" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "recipeVersion" INTEGER NOT NULL,
    "status" "ExecutionStatus" NOT NULL DEFAULT 'QUEUED',
    "idempotencyKey" TEXT NOT NULL,
    "triggerRunId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "capture_job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "capture" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "captureJobId" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "recipeVersion" INTEGER NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" "ExecutionStatus" NOT NULL DEFAULT 'QUEUED',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failureCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "capture_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "captureId" TEXT,
    "parentAssetId" TEXT,
    "objectKey" TEXT NOT NULL,
    "sha256" TEXT,
    "mediaType" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "status" "AssetStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creative_variant" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "sourceAssetId" TEXT NOT NULL,
    "brandKitId" TEXT NOT NULL,
    "brandKitVersion" INTEGER NOT NULL,
    "templateId" TEXT NOT NULL,
    "templateVersion" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL,
    "aspectRatio" TEXT NOT NULL,
    "status" "VariantStatus" NOT NULL DEFAULT 'DRAFT',
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "creative_variant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_connection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalAccountId" TEXT NOT NULL,
    "secretReference" TEXT NOT NULL,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_connection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_post" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "channelConnectionId" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "status" "ScheduledPostStatus" NOT NULL DEFAULT 'DRAFT',
    "caption" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "triggerRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publication_attempt" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "scheduledPostId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "outcome" "AttemptOutcome",
    "providerPostId" TEXT,
    "failureCode" TEXT,

    CONSTRAINT "publication_attempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_event" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "processingAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE INDEX "session_userId_idx" ON "session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_key" ON "session"("token");

-- CreateIndex
CREATE INDEX "account_userId_idx" ON "account"("userId");

-- CreateIndex
CREATE INDEX "verification_identifier_idx" ON "verification"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "organization_slug_key" ON "organization"("slug");

-- CreateIndex
CREATE INDEX "member_organizationId_idx" ON "member"("organizationId");

-- CreateIndex
CREATE INDEX "member_userId_idx" ON "member"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "member_organizationId_userId_key" ON "member"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "invitation_organizationId_idx" ON "invitation"("organizationId");

-- CreateIndex
CREATE INDEX "invitation_email_idx" ON "invitation"("email");

-- CreateIndex
CREATE INDEX "apikey_configId_idx" ON "apikey"("configId");

-- CreateIndex
CREATE INDEX "apikey_referenceId_idx" ON "apikey"("referenceId");

-- CreateIndex
CREATE INDEX "apikey_key_idx" ON "apikey"("key");

-- CreateIndex
CREATE INDEX "twoFactor_secret_idx" ON "twoFactor"("secret");

-- CreateIndex
CREATE INDEX "twoFactor_userId_idx" ON "twoFactor"("userId");

-- CreateIndex
CREATE INDEX "ssoProvider_organizationId_idx" ON "ssoProvider"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ssoProvider_providerId_key" ON "ssoProvider"("providerId");

-- CreateIndex
CREATE INDEX "scimProvider_organizationId_idx" ON "scimProvider"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "scimProvider_providerId_key" ON "scimProvider"("providerId");

-- CreateIndex
CREATE UNIQUE INDEX "scimProvider_scimToken_key" ON "scimProvider"("scimToken");

-- CreateIndex
CREATE INDEX "audit_log_organizationId_createdAt_id_idx" ON "audit_log"("organizationId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "audit_log_organizationId_action_createdAt_idx" ON "audit_log"("organizationId", "action", "createdAt");

-- CreateIndex
CREATE INDEX "audit_log_organizationId_actorUserId_createdAt_idx" ON "audit_log"("organizationId", "actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_drain_organizationId_enabled_idx" ON "audit_drain"("organizationId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "audit_drain_organizationId_name_key" ON "audit_drain"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "audit_outbox_auditLogId_key" ON "audit_outbox"("auditLogId");

-- CreateIndex
CREATE INDEX "audit_drain_delivery_status_nextAttemptAt_idx" ON "audit_drain_delivery"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "audit_drain_delivery_drainId_outboxId_key" ON "audit_drain_delivery"("drainId", "outboxId");

-- CreateIndex
CREATE INDEX "support_access_grant_organizationId_expiresAt_idx" ON "support_access_grant"("organizationId", "expiresAt");

-- CreateIndex
CREATE INDEX "support_access_grant_userId_expiresAt_idx" ON "support_access_grant"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "screenshot_cache_urlHash_key" ON "screenshot_cache"("urlHash");

-- CreateIndex
CREATE UNIQUE INDEX "screenshot_cache_cloudinaryPublicId_key" ON "screenshot_cache"("cloudinaryPublicId");

-- CreateIndex
CREATE INDEX "screenshot_cache_urlHash_idx" ON "screenshot_cache"("urlHash");

-- CreateIndex
CREATE INDEX "screenshot_cache_createdAt_idx" ON "screenshot_cache"("createdAt");

-- CreateIndex
CREATE INDEX "brand_kit_organizationId_createdAt_idx" ON "brand_kit"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "brand_kit_organizationId_name_version_key" ON "brand_kit"("organizationId", "name", "version");

-- CreateIndex
CREATE INDEX "source_app_organizationId_createdAt_idx" ON "source_app"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "source_app_organizationId_name_key" ON "source_app"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "source_app_provider_externalId_key" ON "source_app"("provider", "externalId");

-- CreateIndex
CREATE INDEX "capture_recipe_organizationId_createdAt_idx" ON "capture_recipe"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "capture_recipe_sourceAppId_idx" ON "capture_recipe"("sourceAppId");

-- CreateIndex
CREATE UNIQUE INDEX "capture_recipe_organizationId_name_version_key" ON "capture_recipe"("organizationId", "name", "version");

-- CreateIndex
CREATE INDEX "creative_template_organizationId_createdAt_idx" ON "creative_template"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "creative_template_organizationId_name_version_key" ON "creative_template"("organizationId", "name", "version");

-- CreateIndex
CREATE INDEX "release_organizationId_status_updatedAt_idx" ON "release"("organizationId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "release_organizationId_createdAt_idx" ON "release"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "release_document_organizationId_createdAt_idx" ON "release_document"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "release_document_releaseId_revision_key" ON "release_document"("releaseId", "revision");

-- CreateIndex
CREATE INDEX "customer_communication_organizationId_status_scheduledFor_idx" ON "customer_communication"("organizationId", "status", "scheduledFor");

-- CreateIndex
CREATE UNIQUE INDEX "customer_communication_organizationId_idempotencyKey_key" ON "customer_communication"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "communication_attempt_organizationId_startedAt_idx" ON "communication_attempt"("organizationId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "communication_attempt_customerCommunicationId_attemptNumber_key" ON "communication_attempt"("customerCommunicationId", "attemptNumber");

-- CreateIndex
CREATE INDEX "capture_job_organizationId_createdAt_idx" ON "capture_job"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "capture_job_organizationId_idempotencyKey_key" ON "capture_job"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "capture_organizationId_createdAt_idx" ON "capture"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "capture_releaseId_idx" ON "capture"("releaseId");

-- CreateIndex
CREATE UNIQUE INDEX "asset_objectKey_key" ON "asset"("objectKey");

-- CreateIndex
CREATE INDEX "asset_organizationId_createdAt_idx" ON "asset"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "asset_captureId_idx" ON "asset"("captureId");

-- CreateIndex
CREATE INDEX "creative_variant_organizationId_createdAt_idx" ON "creative_variant"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "creative_variant_releaseId_aspectRatio_revision_key" ON "creative_variant"("releaseId", "aspectRatio", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "approval_variantId_key" ON "approval"("variantId");

-- CreateIndex
CREATE INDEX "approval_organizationId_createdAt_idx" ON "approval"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "channel_connection_organizationId_createdAt_idx" ON "channel_connection"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "channel_connection_organizationId_provider_externalAccountI_key" ON "channel_connection"("organizationId", "provider", "externalAccountId");

-- CreateIndex
CREATE INDEX "scheduled_post_organizationId_status_scheduledFor_idx" ON "scheduled_post"("organizationId", "status", "scheduledFor");

-- CreateIndex
CREATE UNIQUE INDEX "scheduled_post_channelConnectionId_idempotencyKey_key" ON "scheduled_post"("channelConnectionId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "publication_attempt_organizationId_startedAt_idx" ON "publication_attempt"("organizationId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "publication_attempt_scheduledPostId_attemptNumber_key" ON "publication_attempt"("scheduledPostId", "attemptNumber");

-- CreateIndex
CREATE INDEX "outbox_event_deliveredAt_createdAt_idx" ON "outbox_event"("deliveredAt", "createdAt");

-- CreateIndex
CREATE INDEX "outbox_event_organizationId_createdAt_idx" ON "outbox_event"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_event_organizationId_idempotencyKey_key" ON "outbox_event"("organizationId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member" ADD CONSTRAINT "member_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member" ADD CONSTRAINT "member_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "twoFactor" ADD CONSTRAINT "twoFactor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ssoProvider" ADD CONSTRAINT "ssoProvider_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_enterprise_settings" ADD CONSTRAINT "organization_enterprise_settings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_retention_policy" ADD CONSTRAINT "audit_retention_policy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_drain" ADD CONSTRAINT "audit_drain_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_outbox" ADD CONSTRAINT "audit_outbox_auditLogId_fkey" FOREIGN KEY ("auditLogId") REFERENCES "audit_log"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_drain_delivery" ADD CONSTRAINT "audit_drain_delivery_drainId_fkey" FOREIGN KEY ("drainId") REFERENCES "audit_drain"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_drain_delivery" ADD CONSTRAINT "audit_drain_delivery_outboxId_fkey" FOREIGN KEY ("outboxId") REFERENCES "audit_outbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_access_grant" ADD CONSTRAINT "support_access_grant_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_access_grant" ADD CONSTRAINT "support_access_grant_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_access_grant" ADD CONSTRAINT "support_access_grant_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_access_grant" ADD CONSTRAINT "support_access_grant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_kit" ADD CONSTRAINT "brand_kit_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_app" ADD CONSTRAINT "source_app_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capture_recipe" ADD CONSTRAINT "capture_recipe_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capture_recipe" ADD CONSTRAINT "capture_recipe_sourceAppId_fkey" FOREIGN KEY ("sourceAppId") REFERENCES "source_app"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creative_template" ADD CONSTRAINT "creative_template_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "release" ADD CONSTRAINT "release_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "release" ADD CONSTRAINT "release_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "release_document" ADD CONSTRAINT "release_document_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "release_document" ADD CONSTRAINT "release_document_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "release"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_communication" ADD CONSTRAINT "customer_communication_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_communication" ADD CONSTRAINT "customer_communication_releaseDocumentId_fkey" FOREIGN KEY ("releaseDocumentId") REFERENCES "release_document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_attempt" ADD CONSTRAINT "communication_attempt_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_attempt" ADD CONSTRAINT "communication_attempt_customerCommunicationId_fkey" FOREIGN KEY ("customerCommunicationId") REFERENCES "customer_communication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capture_job" ADD CONSTRAINT "capture_job_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capture_job" ADD CONSTRAINT "capture_job_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "release"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capture_job" ADD CONSTRAINT "capture_job_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "capture_recipe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capture" ADD CONSTRAINT "capture_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capture" ADD CONSTRAINT "capture_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "release"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capture" ADD CONSTRAINT "capture_captureJobId_fkey" FOREIGN KEY ("captureJobId") REFERENCES "capture_job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset" ADD CONSTRAINT "asset_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset" ADD CONSTRAINT "asset_captureId_fkey" FOREIGN KEY ("captureId") REFERENCES "capture"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset" ADD CONSTRAINT "asset_parentAssetId_fkey" FOREIGN KEY ("parentAssetId") REFERENCES "asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creative_variant" ADD CONSTRAINT "creative_variant_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creative_variant" ADD CONSTRAINT "creative_variant_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "release"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creative_variant" ADD CONSTRAINT "creative_variant_sourceAssetId_fkey" FOREIGN KEY ("sourceAssetId") REFERENCES "asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creative_variant" ADD CONSTRAINT "creative_variant_brandKitId_fkey" FOREIGN KEY ("brandKitId") REFERENCES "brand_kit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creative_variant" ADD CONSTRAINT "creative_variant_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "creative_template"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creative_variant" ADD CONSTRAINT "creative_variant_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval" ADD CONSTRAINT "approval_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval" ADD CONSTRAINT "approval_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "creative_variant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_connection" ADD CONSTRAINT "channel_connection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_post" ADD CONSTRAINT "scheduled_post_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_post" ADD CONSTRAINT "scheduled_post_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "creative_variant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_post" ADD CONSTRAINT "scheduled_post_channelConnectionId_fkey" FOREIGN KEY ("channelConnectionId") REFERENCES "channel_connection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publication_attempt" ADD CONSTRAINT "publication_attempt_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publication_attempt" ADD CONSTRAINT "publication_attempt_scheduledPostId_fkey" FOREIGN KEY ("scheduledPostId") REFERENCES "scheduled_post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbox_event" ADD CONSTRAINT "outbox_event_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
