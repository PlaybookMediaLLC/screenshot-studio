-- Capture source identity when the canonical event commits, rather than deriving
-- historical attribution from a draft's later destination. Existing events stay
-- unknown: a current association is not proof of their original source.
ALTER TABLE outbox_event ADD COLUMN notification_social_set_id text NOT NULL DEFAULT '';

CREATE FUNCTION platform_notification_source_context() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_id text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.notification_social_set_id IS DISTINCT FROM OLD.notification_social_set_id THEN
      RAISE EXCEPTION 'notification source is immutable';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.type LIKE 'activity.%' THEN
    CASE NEW."aggregateType"
      WHEN 'content_draft' THEN
        SELECT "socialSetId" INTO source_id FROM content_draft WHERE id=NEW."aggregateId" AND "organizationId"=NEW."organizationId";
      WHEN 'scheduled_post' THEN
        SELECT "socialSetId" INTO source_id FROM scheduled_post WHERE id=NEW."aggregateId" AND "organizationId"=NEW."organizationId";
      WHEN 'channel_connection' THEN
        SELECT "socialSetId" INTO source_id FROM channel_connection WHERE id=NEW."aggregateId" AND "organizationId"=NEW."organizationId";
      WHEN 'social_set' THEN
        SELECT id INTO source_id FROM social_set WHERE id=NEW."aggregateId" AND "organizationId"=NEW."organizationId";
      ELSE NULL;
    END CASE;
  END IF;
  -- Never accept caller-supplied provenance. Keep IDs without a foreign key so
  -- source deletion cannot destroy an event, delivery receipt or audit lineage.
  NEW.notification_social_set_id := COALESCE(source_id, '');
  RETURN NEW;
END $$;
CREATE TRIGGER platform_notification_source_context
  BEFORE INSERT OR UPDATE OF notification_social_set_id ON outbox_event
  FOR EACH ROW EXECUTE FUNCTION platform_notification_source_context();
