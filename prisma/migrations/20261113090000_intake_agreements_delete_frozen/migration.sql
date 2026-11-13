-- INTAKE-02: an agreement of a submitted version can no longer be deleted either.
-- Withdrawing (a delete) stays possible while the version is being prepared.
-- A whole protocol can still be deleted: the cascade removes protocol_intakes before
-- intake_agreements, so by the time this trigger runs for a cascaded row its intake (and
-- the version join) is gone and the EXISTS check finds nothing.
CREATE OR REPLACE FUNCTION recdms_intake_agreement_frozen() RETURNS trigger AS $$
DECLARE
  row_intake TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    row_intake := OLD.intake_id;
  ELSE
    row_intake := NEW.intake_id;
  END IF;
  IF EXISTS (
    SELECT 1 FROM protocol_intakes i JOIN protocol_versions v ON v.id = i.protocol_version_id
    WHERE i.id = row_intake AND v.state = 'SUBMITTED'
  ) AND (
    TG_OP <> 'UPDATE'
    OR NEW.agreed_at IS DISTINCT FROM OLD.agreed_at
    OR NEW.member_id IS DISTINCT FROM OLD.member_id
    OR NEW.kind IS DISTINCT FROM OLD.kind
  ) THEN
    RAISE EXCEPTION 'agreements of a submitted protocol version are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS intake_agreements_frozen ON "intake_agreements";
CREATE TRIGGER intake_agreements_frozen
  BEFORE INSERT OR UPDATE OR DELETE ON "intake_agreements"
  FOR EACH ROW EXECUTE FUNCTION recdms_intake_agreement_frozen();
