-- Keep a safe, session-bound result after consuming a provider authorization.
-- Existing pending starts and Slack's single-use starts keep their semantics.
ALTER TABLE social_oauth_start
    ADD COLUMN "exchangeStatus" text NOT NULL DEFAULT 'PENDING',
    ADD COLUMN "exchangeReceipt" jsonb,
    ADD COLUMN "expectedConnectionId" text,
    ADD COLUMN "returnPath" text NOT NULL DEFAULT '',
    ADD COLUMN "completedConnectionId" text,
    ADD COLUMN "completedAt" timestamp(3),
    ADD CONSTRAINT social_oauth_exchange_status CHECK ("exchangeStatus" IN ('PENDING','EXCHANGING','EXCHANGED','COMPLETED')),
    ADD CONSTRAINT social_oauth_completed_receipt CHECK ("exchangeStatus" <> 'COMPLETED' OR ("completedConnectionId" IS NOT NULL AND "completedAt" IS NOT NULL));

CREATE INDEX social_oauth_session_receipt ON social_oauth_start ("userId","sessionId","createdAt");
