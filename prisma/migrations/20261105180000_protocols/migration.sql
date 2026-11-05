-- CreateEnum
CREATE TYPE "ReviewType" AS ENUM ('EXEMPT', 'EXPEDITED', 'FULL');

-- CreateEnum
CREATE TYPE "ProtocolVersionState" AS ENUM ('WORKING', 'SUBMITTED');

-- CreateEnum
CREATE TYPE "FileKind" AS ENUM ('MANUSCRIPT', 'COVER_LETTER', 'FEE_RECEIPT', 'SUPPORTING', 'GENERATED_DOCX', 'GENERATED_PDF', 'SIGNATURE_IMAGE', 'TEMPLATE');

-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('PENDING', 'CLEAN', 'INFECTED');

-- CreateEnum
CREATE TYPE "FeeStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateTable
CREATE TABLE "panels" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "panels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disciplines" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "panel_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "disciplines_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "protocols" ADD COLUMN "discipline_id" TEXT,
ADD COLUMN "panel_id" TEXT,
ADD COLUMN "review_type" "ReviewType",
ADD COLUMN "status" TEXT NOT NULL DEFAULT 'DRAFT',
ADD COLUMN "leader_user_id" TEXT,
ADD COLUMN "institution" TEXT NOT NULL DEFAULT '',
ADD COLUMN "institution_address" TEXT NOT NULL DEFAULT '',
ADD COLUMN "research_type" TEXT NOT NULL DEFAULT '',
ADD COLUMN "duration_months" INTEGER,
ADD COLUMN "expected_participants" INTEGER,
ADD COLUMN "study_site" TEXT NOT NULL DEFAULT '',
ADD COLUMN "funding_sources" JSONB NOT NULL DEFAULT '[]';

UPDATE "protocols" SET "leader_user_id" = "created_by_id" WHERE "leader_user_id" IS NULL;

ALTER TABLE "protocols" ALTER COLUMN "leader_user_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "protocol_members" ALTER COLUMN "user_id" DROP NOT NULL;
ALTER TABLE "protocol_members" ALTER COLUMN "contact_email_id" DROP NOT NULL;
ALTER TABLE "protocol_members" ALTER COLUMN "affiliation_kind" DROP NOT NULL;
ALTER TABLE "protocol_members" ALTER COLUMN "institution" SET DEFAULT '';
ALTER TABLE "protocol_members" ALTER COLUMN "designation" SET DEFAULT '';

-- CreateTable
CREATE TABLE "protocol_versions" (
    "id" TEXT NOT NULL,
    "protocol_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "state" "ProtocolVersionState" NOT NULL DEFAULT 'WORKING',
    "submitted_at" TIMESTAMP(3),
    "submitted_by_id" TEXT,
    "snapshot" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "protocol_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "files" (
    "id" TEXT NOT NULL,
    "protocol_version_id" TEXT,
    "kind" "FileKind" NOT NULL,
    "original_name" TEXT NOT NULL,
    "suggested_name" TEXT,
    "storage_key" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploaded_by_id" TEXT NOT NULL,
    "scan_status" "ScanStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_verifications" (
    "id" TEXT NOT NULL,
    "protocol_version_id" TEXT NOT NULL,
    "status" "FeeStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "verified_by_id" TEXT,
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fee_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "presence" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "form_instance_id" TEXT NOT NULL,
    "seen_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "presence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "upload_intents" (
    "id" TEXT NOT NULL,
    "protocol_version_id" TEXT NOT NULL,
    "kind" "FileKind" NOT NULL,
    "storage_key" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "suggested_name" TEXT,
    "mime" TEXT NOT NULL,
    "uploaded_by_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "upload_intents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "panels_code_key" ON "panels"("code");

-- CreateIndex
CREATE UNIQUE INDEX "disciplines_name_key" ON "disciplines"("name");

-- CreateIndex
CREATE INDEX "disciplines_panel_id_idx" ON "disciplines"("panel_id");

-- CreateIndex
CREATE INDEX "protocols_status_idx" ON "protocols"("status");

-- CreateIndex
CREATE INDEX "protocols_leader_user_id_idx" ON "protocols"("leader_user_id");

-- CreateIndex
CREATE INDEX "protocols_discipline_id_idx" ON "protocols"("discipline_id");

-- CreateIndex
CREATE INDEX "protocols_panel_id_idx" ON "protocols"("panel_id");

-- CreateIndex
CREATE INDEX "protocol_members_invited_email_idx" ON "protocol_members"("invited_email");

-- CreateIndex
CREATE INDEX "protocol_members_protocol_id_status_idx" ON "protocol_members"("protocol_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "protocol_members_open_invite_email_key" ON "protocol_members"("protocol_id", "invited_email") WHERE "invited_email" IS NOT NULL AND "status" <> 'REMOVED';

-- CreateIndex
CREATE INDEX "protocol_versions_protocol_id_state_idx" ON "protocol_versions"("protocol_id", "state");

-- CreateIndex
CREATE UNIQUE INDEX "protocol_versions_protocol_id_number_key" ON "protocol_versions"("protocol_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "files_storage_key_key" ON "files"("storage_key");

-- CreateIndex
CREATE INDEX "files_protocol_version_id_kind_idx" ON "files"("protocol_version_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "fee_verifications_protocol_version_id_key" ON "fee_verifications"("protocol_version_id");

-- CreateIndex
CREATE INDEX "fee_verifications_status_idx" ON "fee_verifications"("status");

-- CreateIndex
CREATE INDEX "presence_form_instance_id_seen_at_idx" ON "presence"("form_instance_id", "seen_at");

-- CreateIndex
CREATE UNIQUE INDEX "presence_user_id_form_instance_id_key" ON "presence"("user_id", "form_instance_id");

-- CreateIndex
CREATE UNIQUE INDEX "upload_intents_storage_key_key" ON "upload_intents"("storage_key");

-- CreateIndex
CREATE INDEX "upload_intents_expires_at_idx" ON "upload_intents"("expires_at");

-- AddForeignKey
ALTER TABLE "disciplines" ADD CONSTRAINT "disciplines_panel_id_fkey" FOREIGN KEY ("panel_id") REFERENCES "panels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "protocols" ADD CONSTRAINT "protocols_leader_user_id_fkey" FOREIGN KEY ("leader_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "protocols" ADD CONSTRAINT "protocols_discipline_id_fkey" FOREIGN KEY ("discipline_id") REFERENCES "disciplines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "protocols" ADD CONSTRAINT "protocols_panel_id_fkey" FOREIGN KEY ("panel_id") REFERENCES "panels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "protocol_members" ADD CONSTRAINT "protocol_members_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "protocol_versions" ADD CONSTRAINT "protocol_versions_protocol_id_fkey" FOREIGN KEY ("protocol_id") REFERENCES "protocols"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "protocol_versions" ADD CONSTRAINT "protocol_versions_submitted_by_id_fkey" FOREIGN KEY ("submitted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_protocol_version_id_fkey" FOREIGN KEY ("protocol_version_id") REFERENCES "protocol_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_verifications" ADD CONSTRAINT "fee_verifications_protocol_version_id_fkey" FOREIGN KEY ("protocol_version_id") REFERENCES "protocol_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_verifications" ADD CONSTRAINT "fee_verifications_verified_by_id_fkey" FOREIGN KEY ("verified_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "presence" ADD CONSTRAINT "presence_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upload_intents" ADD CONSTRAINT "upload_intents_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A submitted version keeps its snapshot. updated_at may still move.
CREATE OR REPLACE FUNCTION recdms_protocol_version_immutable() RETURNS trigger AS $$
BEGIN
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

DROP TRIGGER IF EXISTS protocol_versions_immutable ON protocol_versions;
CREATE TRIGGER protocol_versions_immutable
  BEFORE UPDATE ON protocol_versions
  FOR EACH ROW
  EXECUTE FUNCTION recdms_protocol_version_immutable();

CREATE OR REPLACE FUNCTION recdms_form_instance_locked() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'LOCKED' AND (
    NEW.data IS DISTINCT FROM OLD.data
    OR NEW.status IS DISTINCT FROM OLD.status
    OR NEW.revision IS DISTINCT FROM OLD.revision
  ) THEN
    RAISE EXCEPTION 'locked form instance is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS form_instances_locked ON form_instances;
CREATE TRIGGER form_instances_locked
  BEFORE UPDATE ON form_instances
  FOR EACH ROW
  EXECUTE FUNCTION recdms_form_instance_locked();
