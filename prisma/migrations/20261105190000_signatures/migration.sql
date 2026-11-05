-- CreateEnum
CREATE TYPE "SignatureCapture" AS ENUM ('DRAWN', 'UPLOADED');

-- CreateEnum
CREATE TYPE "SignatureEventMethod" AS ENUM ('IMAGE');

-- AlterTable
ALTER TABLE "signatures" ADD COLUMN "file_id" TEXT,
ADD COLUMN "method" "SignatureCapture" NOT NULL DEFAULT 'UPLOADED';

-- Keep a single active image when older rows were all marked active.
UPDATE "signatures" AS later
SET "active" = false
WHERE "active" = true
  AND EXISTS (
    SELECT 1
    FROM "signatures" AS earlier
    WHERE earlier."user_id" = later."user_id"
      AND earlier."active" = true
      AND (
        earlier."version" > later."version"
        OR (earlier."version" = later."version" AND earlier."created_at" > later."created_at")
        OR (earlier."version" = later."version" AND earlier."created_at" = later."created_at" AND earlier."id" > later."id")
      )
  );

-- CreateIndex
CREATE UNIQUE INDEX "signatures_file_id_key" ON "signatures"("file_id");

-- One active signature image per person.
CREATE UNIQUE INDEX "signatures_one_active_per_user" ON "signatures"("user_id") WHERE "active" = true;

-- CreateTable
CREATE TABLE "signing_step_ups" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "confirmed_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "signing_step_ups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signature_events" (
    "id" TEXT NOT NULL,
    "form_instance_id" TEXT NOT NULL,
    "field_path" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "signature_id" TEXT NOT NULL,
    "data_hash" TEXT NOT NULL,
    "protocol_version_id" TEXT,
    "signed_at" TIMESTAMP(3) NOT NULL,
    "ip" TEXT,
    "user_agent" TEXT,
    "voided_at" TIMESTAMP(3),
    "void_reason" TEXT,
    "verify_ref" TEXT NOT NULL,
    "method" "SignatureEventMethod" NOT NULL DEFAULT 'IMAGE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "signature_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "signature_events_verify_ref_key" ON "signature_events"("verify_ref");

-- CreateIndex
CREATE INDEX "signing_step_ups_user_id_expires_at_idx" ON "signing_step_ups"("user_id", "expires_at");

-- CreateIndex
CREATE INDEX "signature_events_form_instance_id_idx" ON "signature_events"("form_instance_id");

-- CreateIndex
CREATE INDEX "signature_events_user_id_idx" ON "signature_events"("user_id");

-- CreateIndex
CREATE INDEX "signature_events_protocol_version_id_idx" ON "signature_events"("protocol_version_id");

-- AddForeignKey
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signing_step_ups" ADD CONSTRAINT "signing_step_ups_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signature_events" ADD CONSTRAINT "signature_events_form_instance_id_fkey" FOREIGN KEY ("form_instance_id") REFERENCES "form_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signature_events" ADD CONSTRAINT "signature_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signature_events" ADD CONSTRAINT "signature_events_signature_id_fkey" FOREIGN KEY ("signature_id") REFERENCES "signatures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signature_events" ADD CONSTRAINT "signature_events_protocol_version_id_fkey" FOREIGN KEY ("protocol_version_id") REFERENCES "protocol_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
