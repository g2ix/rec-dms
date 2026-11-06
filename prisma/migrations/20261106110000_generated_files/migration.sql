-- Generated DOCX and PDF files remember which form revision they came from.
ALTER TABLE "files" ADD COLUMN "form_instance_id" TEXT;
ALTER TABLE "files" ADD COLUMN "source_revision" INTEGER;

CREATE INDEX "files_form_instance_id_kind_source_revision_idx" ON "files"("form_instance_id", "kind", "source_revision");

ALTER TABLE "files" ADD CONSTRAINT "files_form_instance_id_fkey" FOREIGN KEY ("form_instance_id") REFERENCES "form_instances"("id") ON DELETE SET NULL ON UPDATE CASCADE;
