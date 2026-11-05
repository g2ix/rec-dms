-- Append-only audit log. UPDATE and DELETE are rejected for every role,
-- including the table owner, until this trigger is disabled.
CREATE OR REPLACE FUNCTION recdms_reject_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END;
$$;

DROP TRIGGER IF EXISTS audit_events_append_only ON audit_events;
CREATE TRIGGER audit_events_append_only
BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW
EXECUTE FUNCTION recdms_reject_audit_mutation();

CREATE INDEX IF NOT EXISTS "audit_events_protocol_id_idx" ON "audit_events"("protocol_id");
CREATE INDEX IF NOT EXISTS "audit_events_actor_user_id_idx" ON "audit_events"("actor_user_id");
CREATE INDEX IF NOT EXISTS "audit_events_occurred_at_idx" ON "audit_events"("occurred_at");
