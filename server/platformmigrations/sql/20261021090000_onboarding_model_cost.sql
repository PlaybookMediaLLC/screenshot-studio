-- Onboarding spends no AI credits (docs/rfcs/032): the platform pays for the
-- run's model calls, so each run records what they cost.
ALTER TABLE "onboarding_run" ADD COLUMN "modelCostMicros" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "onboarding_run" ADD CONSTRAINT "onboarding_run_modelCostMicros_check" CHECK ("modelCostMicros" >= 0);
