-- Support enforced SCIM deactivation through Better Auth's admin plugin.
ALTER TABLE "user"
  ADD COLUMN "role" TEXT DEFAULT 'user',
  ADD COLUMN "banned" BOOLEAN DEFAULT false,
  ADD COLUMN "banReason" TEXT,
  ADD COLUMN "banExpires" TIMESTAMP(3);
