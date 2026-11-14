-- INTAKE-04: comments pinned to an intake section or upload when a protocol is returned, and the
-- link from a carried-over upload to the file it was copied from.
CREATE TABLE "revision_notes" (
    "id" TEXT NOT NULL,
    "protocol_version_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "author_role" TEXT NOT NULL,
    "anchor" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "task_id" TEXT,
    "sent_at" TIMESTAMP(3),
    "done_at" TIMESTAMP(3),
    "done_by_id" TEXT,
    "reply" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "revision_notes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "revision_notes_protocol_version_id_task_id_idx" ON "revision_notes"("protocol_version_id", "task_id");

ALTER TABLE "revision_notes" ADD CONSTRAINT "revision_notes_protocol_version_id_fkey" FOREIGN KEY ("protocol_version_id") REFERENCES "protocol_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "files" ADD COLUMN "carried_from_id" TEXT;
