-- Linking an installation the user already has: GitHub verifies which ones the
-- user can reach, and the grant keeps them until the user picks one.
ALTER TABLE "github_install_start" ADD COLUMN "installationIds" JSONB;
