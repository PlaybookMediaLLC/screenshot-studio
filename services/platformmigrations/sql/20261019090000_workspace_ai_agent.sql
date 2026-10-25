-- The per-workspace AI agent kill switch (docs/rfcs/027-ai-sdk-marketing-tools.md).
-- On by default; an owner or admin turns it off without a deploy.
ALTER TABLE "workspace_settings" ADD COLUMN "aiAgentEnabled" BOOLEAN NOT NULL DEFAULT true;
