-- Media scheduling: what a video upload holds, read from its container when the
-- upload completes, so scheduling checks each destination's length and codecs.
-- Existing rows stay NULL (unknown); scheduling reads such a video on demand.
ALTER TABLE "asset" ADD COLUMN "durationMs" integer CHECK ("durationMs" IS NULL OR "durationMs" >= 0);
ALTER TABLE "asset" ADD COLUMN "codecs" text;
