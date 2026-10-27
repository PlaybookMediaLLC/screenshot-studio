-- Conversations are a view of agent runs (docs/rfcs/028-conversational-campaign-creation.md).
-- Losing one loses history only: the campaign survives (SET NULL), and the
-- run trace stays on launch_run_step.
CREATE TABLE "conversation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "campaignId" TEXT,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "conversation_status_check" CHECK ("status" IN ('ACTIVE', 'ARCHIVED'))
);
CREATE INDEX "conversation_organizationId_updatedAt_idx" ON "conversation"("organizationId", "updatedAt");
CREATE INDEX "conversation_organizationId_campaignId_updatedAt_idx" ON "conversation"("organizationId", "campaignId", "updatedAt");
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "conversation_message" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "launchRunId" TEXT,
    "toolName" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_message_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "conversation_message_role_check" CHECK ("role" IN ('user', 'assistant', 'tool')),
    CONSTRAINT "conversation_message_kind_check" CHECK ("kind" IN ('text', 'clarification', 'tool')),
    CONSTRAINT "conversation_message_content_check" CHECK (char_length("content") <= 20000)
);
CREATE INDEX "conversation_message_organizationId_conversationId_createdAt_idx"
    ON "conversation_message"("organizationId", "conversationId", "createdAt");
ALTER TABLE "conversation_message" ADD CONSTRAINT "conversation_message_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversation_message" ADD CONSTRAINT "conversation_message_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversation_message" ADD CONSTRAINT "conversation_message_launchRunId_fkey"
    FOREIGN KEY ("launchRunId") REFERENCES "launch_run"("id") ON DELETE SET NULL ON UPDATE CASCADE;
