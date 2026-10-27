-- A draft can say something different on one channel (RFC 013): the text
-- that channel posts instead of the body's, keyed by channel.
ALTER TABLE "content_draft" ADD COLUMN "channelText" JSONB NOT NULL DEFAULT '{}'::jsonb;
