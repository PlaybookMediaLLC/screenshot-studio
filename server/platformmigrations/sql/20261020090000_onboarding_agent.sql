-- The background onboarding agent (docs/rfcs/034-background-onboarding-agent.md):
-- a run row mirrored from its Temporal workflow, the crawled pages, the ideal
-- customer profile, and cached enrichment results. Every row is workspace-scoped.
CREATE TABLE "onboarding_run" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "stage" TEXT NOT NULL DEFAULT 'fast_path',
    "completedStages" JSONB NOT NULL DEFAULT '[]',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "discoveredUrls" JSONB NOT NULL DEFAULT '[]',
    "pagesDiscovered" INTEGER NOT NULL DEFAULT 0,
    "pagesProcessed" INTEGER NOT NULL DEFAULT 0,
    "pagesSkipped" INTEGER NOT NULL DEFAULT 0,
    "pageLimit" INTEGER NOT NULL DEFAULT 0,
    "tokensUsed" INTEGER NOT NULL DEFAULT 0,
    "tokenBudget" INTEGER NOT NULL DEFAULT 0,
    "enrichmentCostMicros" BIGINT NOT NULL DEFAULT 0,
    "fastPathMs" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "deadlineAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onboarding_run_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "onboarding_run_status_check" CHECK ("status" IN ('queued', 'running', 'completed', 'partial', 'failed', 'cancelled')),
    CONSTRAINT "onboarding_run_progress_check" CHECK ("progress" BETWEEN 0 AND 100),
    CONSTRAINT "onboarding_run_counters_check" CHECK ("pagesDiscovered" >= 0 AND "pagesProcessed" >= 0 AND "pagesSkipped" >= 0
        AND "pageLimit" >= 0 AND "tokensUsed" >= 0 AND "tokenBudget" >= 0 AND "enrichmentCostMicros" >= 0 AND "fastPathMs" >= 0)
);
CREATE UNIQUE INDEX "onboarding_run_organizationId_idempotencyKey_key" ON "onboarding_run"("organizationId", "idempotencyKey");
CREATE INDEX "onboarding_run_organizationId_createdAt_idx" ON "onboarding_run"("organizationId", "createdAt");
-- One active run per workspace, as the workflow ID policy also enforces.
CREATE UNIQUE INDEX "onboarding_run_organizationId_active_key" ON "onboarding_run"("organizationId")
    WHERE "status" IN ('queued', 'running');
ALTER TABLE "onboarding_run" ADD CONSTRAINT "onboarding_run_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "page_knowledge" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "contentHash" TEXT NOT NULL,
    "pageType" TEXT NOT NULL DEFAULT 'other',
    "text" TEXT NOT NULL DEFAULT '',
    "httpStatus" INTEGER NOT NULL DEFAULT 0,
    "etag" TEXT,
    "lastModified" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "page_knowledge_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "page_knowledge_pageType_check" CHECK ("pageType" IN ('homepage', 'pricing', 'features', 'docs', 'changelog', 'about', 'other'))
);
CREATE UNIQUE INDEX "page_knowledge_organizationId_url_key" ON "page_knowledge"("organizationId", "url");
CREATE INDEX "page_knowledge_organizationId_runId_idx" ON "page_knowledge"("organizationId", "runId");
ALTER TABLE "page_knowledge" ADD CONSTRAINT "page_knowledge_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ideal_customer_profile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "personas" JSONB NOT NULL DEFAULT '[]',
    "pains" JSONB NOT NULL DEFAULT '[]',
    "jobs" JSONB NOT NULL DEFAULT '[]',
    "buyingTriggers" JSONB NOT NULL DEFAULT '[]',
    "objections" JSONB NOT NULL DEFAULT '[]',
    "channels" JSONB NOT NULL DEFAULT '[]',
    "provenance" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ideal_customer_profile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ideal_customer_profile_organizationId_key" ON "ideal_customer_profile"("organizationId");
ALTER TABLE "ideal_customer_profile" ADD CONSTRAINT "ideal_customer_profile_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "enrichment_record" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sourceUrl" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "costMicros" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enrichment_record_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "enrichment_record_confidence_check" CHECK ("confidence" BETWEEN 0 AND 1),
    CONSTRAINT "enrichment_record_costMicros_check" CHECK ("costMicros" >= 0)
);
CREATE UNIQUE INDEX "enrichment_record_organizationId_domain_provider_field_key"
    ON "enrichment_record"("organizationId", "domain", "provider", "field");
ALTER TABLE "enrichment_record" ADD CONSTRAINT "enrichment_record_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
