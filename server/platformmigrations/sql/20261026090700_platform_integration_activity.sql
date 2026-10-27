-- The native social provider persists health before returning. Bind only through
-- verified tenant IDs; never infer platform identities from provider emails.
CREATE FUNCTION platform_notification_integration_health() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE workspace_id text; connection_id text; owner_id text; event_kind text; event_id text;
BEGIN
 IF NEW."providerIdentifier"='slack' THEN RETURN NULL; END IF;
 IF (NEW.disabled AND NOT OLD.disabled) OR (NEW."deletedAt" IS NOT NULL AND OLD."deletedAt" IS NULL) THEN event_kind:='integration.disconnected';
 ELSIF NEW."refreshNeeded" AND NOT OLD."refreshNeeded" THEN event_kind:='integration.reconnect_required';
 ELSIF (NOT NEW.disabled AND OLD.disabled) OR (NOT NEW."refreshNeeded" AND OLD."refreshNeeded") THEN event_kind:='integration.connected';
 ELSE RETURN NULL; END IF;
 SELECT "organizationId" INTO workspace_id FROM social_tenant_binding WHERE "goOrganizationId"=NEW."organizationId";
 IF workspace_id IS NULL OR EXISTS(SELECT 1 FROM workspace_deletion WHERE "organizationId"=workspace_id AND status<>'CANCELLED') THEN RETURN NULL; END IF;
 SELECT id,"createdByUserId" INTO connection_id,owner_id FROM channel_connection WHERE "organizationId"=workspace_id AND provider='social' AND "externalAccountId"=NEW.id;
 event_id:=gen_random_uuid()::text;
 INSERT INTO outbox_event(id,"organizationId",type,"aggregateType","aggregateId",payload,"idempotencyKey",notification_version)
 VALUES(event_id,workspace_id,'activity.'||event_kind,'channel_connection',coalesce(connection_id,NEW.id),jsonb_build_object('ownerUserId',coalesce(owner_id,'')),event_id,1);
 RETURN NULL;
END $$;
DO $$ BEGIN
 IF to_regclass('public."Integration"') IS NOT NULL THEN
  CREATE OR REPLACE TRIGGER platform_notification_integration_health AFTER UPDATE ON "Integration" FOR EACH ROW EXECUTE FUNCTION platform_notification_integration_health();
 END IF;
END $$;
