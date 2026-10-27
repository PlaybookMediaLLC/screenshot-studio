-- Better Auth/SCIM membership writes are single SQL transactions. The trigger
-- commits their intent with the membership; explicit product transactions emit
-- their more specific action and suppress this fallback transaction-locally.
CREATE FUNCTION platform_notification_membership_intent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE item member; event_kind text; event_id text; actor_id text;
BEGIN
 IF current_setting('platform.membership_explicit',true)='true' THEN RETURN NULL; END IF;
 IF TG_OP='UPDATE' AND NEW.role IS NOT DISTINCT FROM OLD.role THEN RETURN NULL; END IF;
 IF TG_OP='DELETE' THEN item:=OLD; event_kind:='member.removed';
 ELSIF TG_OP='INSERT' THEN item:=NEW; event_kind:='member.joined'; actor_id:=NEW."userId";
 ELSE item:=NEW; event_kind:='member.role_changed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM organization WHERE id=item."organizationId") OR EXISTS(SELECT 1 FROM workspace_deletion WHERE "organizationId"=item."organizationId" AND status<>'CANCELLED') THEN RETURN NULL; END IF;
 event_id:=gen_random_uuid()::text;
 INSERT INTO outbox_event(id,"organizationId",type,"aggregateType","aggregateId",payload,"idempotencyKey",notification_version)
 VALUES(event_id,item."organizationId",'activity.'||event_kind,'member',item.id,
 jsonb_build_object('affectedUserId',item."userId",'actorUserId',coalesce(actor_id,'')),event_id,1);
 RETURN NULL;
END $$;
CREATE TRIGGER platform_notification_membership_intent AFTER INSERT OR UPDATE OR DELETE ON member FOR EACH ROW EXECUTE FUNCTION platform_notification_membership_intent();

-- Pending review events are converted by notification-cutover only after old senders are drained.
