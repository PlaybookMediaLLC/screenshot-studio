-- Keep non-secret Postiz destination settings with the tenant-owned connection.
ALTER TABLE "channel_connection"
  ADD COLUMN "platform" TEXT NOT NULL DEFAULT 'x',
  ADD COLUMN "providerSettings" JSONB NOT NULL DEFAULT '{}';
