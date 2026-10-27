-- A launch run holds its slot while it heartbeats, and the database allows
-- one running run of each kind per campaign (revisions excepted).
ALTER TABLE "launch_run" ADD COLUMN "heartbeatAt" TIMESTAMP(3);

UPDATE "launch_run"
SET "status" = 'FAILED', "finishedAt" = CURRENT_TIMESTAMP, "error" = 'The run stopped responding.'
WHERE "status" = 'RUNNING' AND "startedAt" < CURRENT_TIMESTAMP - INTERVAL '20 minutes';

UPDATE "launch_run" AS r
SET "status" = 'FAILED', "finishedAt" = CURRENT_TIMESTAMP, "error" = 'A newer run replaced this one.'
WHERE r."status" = 'RUNNING' AND r."kind" <> 'revision' AND EXISTS (
    SELECT 1 FROM "launch_run" AS n
    WHERE n."campaignId" = r."campaignId" AND n."kind" = r."kind" AND n."status" = 'RUNNING'
      AND (n."startedAt", n."id") > (r."startedAt", r."id")
);

CREATE UNIQUE INDEX "launch_run_campaignId_kind_running_key"
ON "launch_run"("campaignId", "kind")
WHERE "status" = 'RUNNING' AND "kind" <> 'revision';
