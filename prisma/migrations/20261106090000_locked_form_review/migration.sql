-- A later workflow step may record remarks on a form locked at submission.
-- The application sets recdms.form_review for that write. The status stays LOCKED.
CREATE OR REPLACE FUNCTION recdms_form_instance_locked() RETURNS trigger AS $$
BEGIN
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
