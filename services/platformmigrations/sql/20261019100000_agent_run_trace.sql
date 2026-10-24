-- Agent runs extend launch_run (docs/rfcs/027-ai-sdk-marketing-tools.md):
-- an agent or conversation run may start before a campaign exists, records
-- its cost counters, and keeps a step-by-step trace in launch_run_step.
ALTER TYPE "LaunchRunStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';
ALTER TYPE "LaunchRunStatus" ADD VALUE IF NOT EXISTS 'BUDGET_EXHAUSTED';

ALTER TABLE "launch_run" ALTER COLUMN "campaignId" DROP NOT NULL;
ALTER TABLE "launch_run" ADD CONSTRAINT "launch_run_campaignId_required_check"
    CHECK ("campaignId" IS NOT NULL OR "kind" IN ('agent', 'conversation'));
ALTER TABLE "launch_run"
    ADD COLUMN "stepCount" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "tokensIn" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "tokensOut" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "costCents" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX "launch_run_organizationId_kind_startedAt_idx" ON "launch_run"("organizationId", "kind", "startedAt");

CREATE TABLE "launch_run_step" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "toolName" TEXT,
    "effect" TEXT,
    "status" TEXT NOT NULL,
    "errorCode" TEXT,
    "inputSummary" JSONB,
    "outputSummary" JSONB,
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "launch_run_step_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "launch_run_step_kind_check" CHECK ("kind" IN ('model', 'tool')),
    CONSTRAINT "launch_run_step_effect_check" CHECK ("effect" IN ('read', 'write', 'render', 'external', 'approval-request')),
    CONSTRAINT "launch_run_step_status_check" CHECK ("status" IN ('SUCCEEDED', 'FAILED', 'DENIED')),
    CONSTRAINT "launch_run_step_counters_check" CHECK ("index" >= 0 AND "tokensIn" >= 0 AND "tokensOut" >= 0 AND "durationMs" >= 0)
);
CREATE UNIQUE INDEX "launch_run_step_runId_index_key" ON "launch_run_step"("runId", "index");
CREATE INDEX "launch_run_step_organizationId_runId_idx" ON "launch_run_step"("organizationId", "runId");
ALTER TABLE "launch_run_step" ADD CONSTRAINT "launch_run_step_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "launch_run_step" ADD CONSTRAINT "launch_run_step_runId_fkey"
    FOREIGN KEY ("runId") REFERENCES "launch_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;
