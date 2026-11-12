-- INTAKE-01: one intake per protocol version. F-27, F-28, F-30 and the proponent columns of
-- F-35, F-36 and F-38 are printed from it; the form copies keep only what reviewers, staff and
-- the chair enter. The F-27 values already on existing protocols are copied by
-- scripts/backfill-intake.ts (run by `pnpm db:seed`), which logs each copy as an audit event.

CREATE TYPE "IntakeAgreementKind" AS ENUM ('DECLARATIONS', 'F28_CONSENT');

ALTER TABLE "form_definitions" ADD COLUMN "retired_from" TIMESTAMP(3);

CREATE TABLE "protocol_intakes" (
    "id" TEXT NOT NULL,
    "protocol_version_id" TEXT NOT NULL,
    "scoping" JSONB NOT NULL DEFAULT '{}',
    "coi" JSONB NOT NULL DEFAULT '{}',
    "budget_lines" JSONB NOT NULL DEFAULT '[]',
    "references" JSONB NOT NULL DEFAULT '{}',
    "actions" JSONB NOT NULL DEFAULT '{}',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "section_revisions" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "protocol_intakes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "intake_agreements" (
    "id" TEXT NOT NULL,
    "intake_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "kind" "IntakeAgreementKind" NOT NULL,
    "agreed_at" TIMESTAMP(3) NOT NULL,
    "signature_event_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "intake_agreements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "protocol_intakes_protocol_version_id_key" ON "protocol_intakes"("protocol_version_id");
CREATE INDEX "intake_agreements_signature_event_id_idx" ON "intake_agreements"("signature_event_id");
CREATE UNIQUE INDEX "intake_agreements_intake_id_member_id_kind_key" ON "intake_agreements"("intake_id", "member_id", "kind");

ALTER TABLE "protocol_intakes" ADD CONSTRAINT "protocol_intakes_protocol_version_id_fkey" FOREIGN KEY ("protocol_version_id") REFERENCES "protocol_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "intake_agreements" ADD CONSTRAINT "intake_agreements_intake_id_fkey" FOREIGN KEY ("intake_id") REFERENCES "protocol_intakes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "intake_agreements" ADD CONSTRAINT "intake_agreements_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "protocol_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "intake_agreements" ADD CONSTRAINT "intake_agreements_signature_event_id_fkey" FOREIGN KEY ("signature_event_id") REFERENCES "signature_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The intake of a submitted version is frozen with it. Only linking a signature to an agreement
-- (signature_event_id) is still allowed, because a signature is recorded when it is made.
CREATE OR REPLACE FUNCTION recdms_intake_frozen() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM protocol_versions v WHERE v.id = OLD.protocol_version_id AND v.state = 'SUBMITTED'
  ) AND (
    NEW.scoping IS DISTINCT FROM OLD.scoping
    OR NEW.coi IS DISTINCT FROM OLD.coi
    OR NEW.budget_lines IS DISTINCT FROM OLD.budget_lines
    OR NEW.references IS DISTINCT FROM OLD.references
    OR NEW.actions IS DISTINCT FROM OLD.actions
  ) THEN
    RAISE EXCEPTION 'intake of a submitted protocol version is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Deletes are not blocked: a version is removed with its protocol, and its intake goes with it.
CREATE TRIGGER protocol_intakes_frozen
  BEFORE UPDATE ON "protocol_intakes"
  FOR EACH ROW EXECUTE FUNCTION recdms_intake_frozen();

CREATE OR REPLACE FUNCTION recdms_intake_agreement_frozen() RETURNS trigger AS $$
DECLARE
  row_intake TEXT;
BEGIN
  row_intake := NEW.intake_id;
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
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER intake_agreements_frozen
  BEFORE INSERT OR UPDATE ON "intake_agreements"
  FOR EACH ROW EXECUTE FUNCTION recdms_intake_agreement_frozen();
