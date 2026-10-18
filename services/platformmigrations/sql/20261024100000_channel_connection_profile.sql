-- A connected account as its platform shows it (name, @handle, avatar), so
-- the composer can say who a post goes out as instead of an integration id.
ALTER TABLE "channel_connection" ADD COLUMN "displayName" TEXT;
ALTER TABLE "channel_connection" ADD COLUMN "handle" TEXT;
ALTER TABLE "channel_connection" ADD COLUMN "avatarUrl" TEXT;
