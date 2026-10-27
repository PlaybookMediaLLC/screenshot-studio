-- The audit log is append-only in the database. Only a transaction that sets
-- SET LOCAL shots.audit_retention = 'on' (the retention purge) may delete rows,
-- and deleting a user may clear its "actorUserId".
CREATE FUNCTION "audit_log_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' AND current_setting('shots.audit_retention', true) = 'on' THEN
        RETURN OLD;
    END IF;
    -- Deleting a user sets "actorUserId" to NULL through its foreign key. That
    -- is the one update allowed, and only when nothing else in the row changes.
    IF TG_OP = 'UPDATE' AND OLD."actorUserId" IS NOT NULL AND NEW."actorUserId" IS NULL
        AND (to_jsonb(NEW) - 'actorUserId') = (to_jsonb(OLD) - 'actorUserId') THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'audit_log is append-only: % refused', TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER "audit_log_append_only"
BEFORE UPDATE OR DELETE ON "audit_log"
FOR EACH ROW EXECUTE FUNCTION "audit_log_append_only"();
