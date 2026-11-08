-- Name parts, organization lists, person profiles, and the directory match.

ALTER TABLE "users" ADD COLUMN "middle_name" TEXT;
ALTER TABLE "users" ADD COLUMN "title" TEXT;
ALTER TABLE "users" ADD COLUMN "suffix" TEXT;
ALTER TABLE "users" ADD COLUMN "credentials" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE TYPE "OrgUnitKind" AS ENUM ('SCHOOL', 'DEPARTMENT', 'OFFICE', 'PROGRAM');
CREATE TYPE "AcademicLevel" AS ENUM ('UNDERGRADUATE', 'GRADUATE');

CREATE TABLE "institutions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'UNIVERSITY',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "institutions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "institutions_name_key" ON "institutions"("name");

CREATE TABLE "org_units" (
    "id" TEXT NOT NULL,
    "institution_id" TEXT NOT NULL,
    "parent_id" TEXT,
    "kind" "OrgUnitKind" NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "academic_level" "AcademicLevel",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_units_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "org_units_code_key" ON "org_units"("code");
CREATE INDEX "org_units_institution_id_idx" ON "org_units"("institution_id");
CREATE INDEX "org_units_parent_id_idx" ON "org_units"("parent_id");

ALTER TABLE "org_units" ADD CONSTRAINT "org_units_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institutions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "org_units" ADD CONSTRAINT "org_units_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "org_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "person_profiles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "institution_id" TEXT,
    "school_id" TEXT,
    "department_id" TEXT,
    "office_id" TEXT,
    "program_id" TEXT,
    "institution_text" TEXT NOT NULL DEFAULT '',
    "unit_text" TEXT NOT NULL DEFAULT '',
    "program_text" TEXT NOT NULL DEFAULT '',
    "academic_level" "AcademicLevel",
    "year_label" TEXT,
    "position" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "person_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "person_profiles_user_id_key" ON "person_profiles"("user_id");
CREATE INDEX "person_profiles_kind_idx" ON "person_profiles"("kind");

ALTER TABLE "person_profiles" ADD CONSTRAINT "person_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "person_profiles" ADD CONSTRAINT "person_profiles_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institutions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "person_profiles" ADD CONSTRAINT "person_profiles_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "org_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "person_profiles" ADD CONSTRAINT "person_profiles_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "org_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "person_profiles" ADD CONSTRAINT "person_profiles_office_id_fkey" FOREIGN KEY ("office_id") REFERENCES "org_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "person_profiles" ADD CONSTRAINT "person_profiles_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "org_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "directory_entries" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "student_number" TEXT,
    "kind" TEXT NOT NULL,
    "institution_id" TEXT,
    "school_id" TEXT,
    "department_id" TEXT,
    "office_id" TEXT,
    "program_id" TEXT,
    "institution_text" TEXT NOT NULL DEFAULT '',
    "unit_text" TEXT NOT NULL DEFAULT '',
    "program_text" TEXT NOT NULL DEFAULT '',
    "academic_level" "AcademicLevel",
    "year_label" TEXT,
    "position" TEXT,
    "linked_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "directory_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "directory_entries_email_key" ON "directory_entries"("email");
CREATE UNIQUE INDEX "directory_entries_linked_user_id_key" ON "directory_entries"("linked_user_id");
CREATE INDEX "directory_entries_kind_idx" ON "directory_entries"("kind");

ALTER TABLE "directory_entries" ADD CONSTRAINT "directory_entries_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institutions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "directory_entries" ADD CONSTRAINT "directory_entries_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "org_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "directory_entries" ADD CONSTRAINT "directory_entries_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "org_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "directory_entries" ADD CONSTRAINT "directory_entries_office_id_fkey" FOREIGN KEY ("office_id") REFERENCES "org_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "directory_entries" ADD CONSTRAINT "directory_entries_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "org_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "directory_entries" ADD CONSTRAINT "directory_entries_linked_user_id_fkey" FOREIGN KEY ("linked_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "protocol_members" ADD COLUMN "profile_kind" TEXT;
ALTER TABLE "protocol_members" ADD COLUMN "academic_level" "AcademicLevel";
ALTER TABLE "protocol_members" ADD COLUMN "school_name" TEXT;
ALTER TABLE "protocol_members" ADD COLUMN "department_name" TEXT;
ALTER TABLE "protocol_members" ADD COLUMN "office_name" TEXT;
ALTER TABLE "protocol_members" ADD COLUMN "program_name" TEXT;

-- New tables are not covered by the earlier grant loop. recdms_app needs a policy
-- or the production role would see zero rows. anon and authenticated stay revoked.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['institutions', 'org_units', 'person_profiles', 'directory_entries']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS recdms_app_all ON %I', t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'recdms_app') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I TO recdms_app', t);
      EXECUTE format(
        'CREATE POLICY recdms_app_all ON %I FOR ALL TO recdms_app USING (true) WITH CHECK (true)',
        t
      );
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON TABLE %I FROM anon', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON TABLE %I FROM authenticated', t);
    END IF;
  END LOOP;
END $$;
