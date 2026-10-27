-- On an empty combined database the social tables are created after platform DDL.
-- Standalone upstream databases have no platform function and stay unchanged.
DO $$ BEGIN
 IF to_regprocedure('public.platform_notification_integration_health()') IS NOT NULL THEN
  CREATE OR REPLACE TRIGGER platform_notification_integration_health AFTER UPDATE ON "Integration" FOR EACH ROW EXECUTE FUNCTION platform_notification_integration_health();
 END IF;
END $$;
