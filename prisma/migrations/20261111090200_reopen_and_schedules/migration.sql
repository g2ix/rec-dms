-- REOPEN_VERSION: a frozen version may go back to WORKING under the same number and label, and
-- its locked forms back to DRAFT, only when the application sets recdms.version_reopen for that
-- transaction. Every other change to a submitted version is still refused.
CREATE OR REPLACE FUNCTION recdms_protocol_version_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD.state = 'SUBMITTED'
    AND current_setting('recdms.version_reopen', true) = 'on'
    AND NEW.state = 'WORKING'
    AND NEW.label IS NOT DISTINCT FROM OLD.label
    AND NEW.number IS NOT DISTINCT FROM OLD.number
    AND NEW.protocol_id IS NOT DISTINCT FROM OLD.protocol_id
  THEN
    RETURN NEW;
  END IF;
  IF OLD.state = 'SUBMITTED' AND (
    NEW.snapshot IS DISTINCT FROM OLD.snapshot
    OR NEW.state IS DISTINCT FROM OLD.state
    OR NEW.label IS DISTINCT FROM OLD.label
    OR NEW.number IS DISTINCT FROM OLD.number
    OR NEW.protocol_id IS DISTINCT FROM OLD.protocol_id
    OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
    OR NEW.submitted_by_id IS DISTINCT FROM OLD.submitted_by_id
  ) THEN
    RAISE EXCEPTION 'submitted protocol version is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION recdms_form_instance_locked() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'LOCKED'
    AND NEW.status = 'DRAFT'
    AND current_setting('recdms.version_reopen', true) = 'on'
    AND NEW.data IS NOT DISTINCT FROM OLD.data
  THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'LOCKED' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'locked form instance is immutable';
  END IF;
  IF OLD.status = 'LOCKED'
    AND current_setting('recdms.form_review', true) IS DISTINCT FROM 'on'
    AND (
      NEW.data IS DISTINCT FROM OLD.data
      OR NEW.revision IS DISTINCT FROM OLD.revision
    ) THEN
    RAISE EXCEPTION 'locked form instance is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- A workflow may have one version in effect now plus versions scheduled for later dates.
DROP INDEX IF EXISTS "workflow_versions_one_published";
CREATE UNIQUE INDEX "workflow_versions_one_published" ON "workflow_versions"("definition_id")
  WHERE "status" = 'PUBLISHED' AND "effective_from" IS NULL;
