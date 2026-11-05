-- CreateEnum
CREATE TYPE "FormDefinitionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');

-- CreateEnum
CREATE TYPE "FormInstanceOwnerType" AS ENUM ('PROTOCOL_VERSION', 'SANDBOX');

-- CreateEnum
CREATE TYPE "FormInstanceStatus" AS ENUM ('DRAFT', 'COMPLETE', 'LOCKED');

-- CreateTable
CREATE TABLE "form_definitions" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "effective_date" DATE NOT NULL,
    "status" "FormDefinitionStatus" NOT NULL DEFAULT 'DRAFT',
    "schema" JSONB NOT NULL,
    "template_file_id" TEXT,
    "placeholder_map" JSONB,
    "created_by_id" TEXT NOT NULL,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "form_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_instances" (
    "id" TEXT NOT NULL,
    "form_definition_id" TEXT NOT NULL,
    "owner_type" "FormInstanceOwnerType" NOT NULL,
    "owner_id" TEXT NOT NULL,
    "filled_by_member_id" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "status" "FormInstanceStatus" NOT NULL DEFAULT 'DRAFT',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "preview_roles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "preview_step" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "form_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_field_revisions" (
    "id" TEXT NOT NULL,
    "form_instance_id" TEXT NOT NULL,
    "field_path" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "user_id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "form_field_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "form_definitions_status_idx" ON "form_definitions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "form_definitions_code_version_key" ON "form_definitions"("code", "version");

-- CreateIndex
CREATE INDEX "form_instances_form_definition_id_idx" ON "form_instances"("form_definition_id");

-- CreateIndex
CREATE INDEX "form_instances_owner_type_owner_id_idx" ON "form_instances"("owner_type", "owner_id");

-- CreateIndex
CREATE INDEX "form_field_revisions_form_instance_id_field_path_idx" ON "form_field_revisions"("form_instance_id", "field_path");

-- CreateIndex
CREATE INDEX "form_field_revisions_form_instance_id_revision_idx" ON "form_field_revisions"("form_instance_id", "revision");

-- AddForeignKey
ALTER TABLE "form_definitions" ADD CONSTRAINT "form_definitions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_instances" ADD CONSTRAINT "form_instances_form_definition_id_fkey" FOREIGN KEY ("form_definition_id") REFERENCES "form_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_instances" ADD CONSTRAINT "form_instances_filled_by_member_id_fkey" FOREIGN KEY ("filled_by_member_id") REFERENCES "protocol_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_field_revisions" ADD CONSTRAINT "form_field_revisions_form_instance_id_fkey" FOREIGN KEY ("form_instance_id") REFERENCES "form_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_field_revisions" ADD CONSTRAINT "form_field_revisions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Keep the Data API out of form tables. The Prisma role bypasses row level security.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['form_definitions', 'form_instances', 'form_field_revisions']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON TABLE %I FROM anon', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON TABLE %I FROM authenticated', t);
    END IF;
  END LOOP;
END $$;
