-- cutover: rename the legacy tenant binding table and the stored legacy names.
-- A new database already has the new names, so every statement is a no-op there.
DO $$
BEGIN
  IF to_regclass('public.postiz_tenant_binding') IS NOT NULL THEN
    ALTER TABLE "postiz_tenant_binding" RENAME TO "social_tenant_binding";
    ALTER TABLE "social_tenant_binding" RENAME CONSTRAINT "postiz_tenant_binding_pkey" TO "social_tenant_binding_pkey";
    ALTER TABLE "social_tenant_binding" RENAME CONSTRAINT "postiz_tenant_binding_organizationId_fkey" TO "social_tenant_binding_organizationId_fkey";
    ALTER INDEX "postiz_tenant_binding_goOrganizationId_key" RENAME TO "social_tenant_binding_goOrganizationId_key";
    ALTER INDEX "postiz_tenant_binding_secretReference_key" RENAME TO "social_tenant_binding_secretReference_key";
  END IF;
END $$;

UPDATE "channel_connection" SET "provider" = 'social' WHERE "provider" = 'postiz';

-- Secret references name environment variables, which lose the legacy prefix too.
UPDATE "channel_connection" SET "secretReference" = 'SOCIAL_' || substr("secretReference", 8)
  WHERE "secretReference" LIKE 'POSTIZ\_%';
UPDATE "social_tenant_binding" SET "secretReference" = 'SOCIAL_' || substr("secretReference", 8)
  WHERE "secretReference" LIKE 'POSTIZ\_%';
UPDATE "social_oauth_start" SET "secretReference" = 'SOCIAL_' || substr("secretReference", 8)
  WHERE "secretReference" LIKE 'POSTIZ\_%';
