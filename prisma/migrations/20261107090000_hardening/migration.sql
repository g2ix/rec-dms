-- prisma-migrate-disable-transaction
-- Restricted application role, row level security, authenticator secrets,
-- and the retention flag. The role is created NOLOGIN. The operator sets
-- LOGIN and the password in the Supabase SQL editor (see docs/DEPLOY.md).
-- The password is not stored in this migration.
--
-- CREATE ROLE cannot run inside a transaction block, including a DO block.
-- The comment above tells Prisma Migrate not to wrap this file.

CREATE ROLE recdms_app NOLOGIN NOBYPASSRLS;

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "totp_secret" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "totp_enabled_at" TIMESTAMP(3);

ALTER TABLE "protocols" ADD COLUMN IF NOT EXISTS "retention_flagged_at" TIMESTAMP(3);

INSERT INTO "settings" ("key", "value", "created_at", "updated_at")
VALUES (
  'retention.policy',
  '{"years":3,"closedStatuses":["Approved","Exempted","Disapproved","Lapsed","Withdrawn"]}'::jsonb,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO NOTHING;

GRANT recdms_app TO CURRENT_USER;

DO $$
DECLARE
  sch text := current_schema();
  tbl text;
  role_name text;
BEGIN
  EXECUTE format('GRANT USAGE ON SCHEMA %I TO recdms_app', sch);

  FOR tbl IN SELECT tablename FROM pg_tables WHERE schemaname = sch
  LOOP
    IF tbl = 'audit_events' THEN
      EXECUTE format('REVOKE ALL ON TABLE %I.%I FROM recdms_app', sch, tbl);
      EXECUTE format('GRANT SELECT, INSERT ON TABLE %I.%I TO recdms_app', sch, tbl);
    ELSE
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I.%I TO recdms_app', sch, tbl);
    END IF;

    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', sch, tbl);
    EXECUTE format('DROP POLICY IF EXISTS recdms_app_all ON %I.%I', sch, tbl);
    EXECUTE format('DROP POLICY IF EXISTS recdms_app_select ON %I.%I', sch, tbl);
    EXECUTE format('DROP POLICY IF EXISTS recdms_app_insert ON %I.%I', sch, tbl);

    -- The migration role owns the tables and bypasses row level security.
    -- recdms_app does not. A policy is required or the production pooler
    -- connection would see zero rows. anon and authenticated receive none.
    IF tbl = 'audit_events' THEN
      EXECUTE format(
        'CREATE POLICY recdms_app_select ON %I.%I FOR SELECT TO recdms_app USING (true)',
        sch, tbl
      );
      EXECUTE format(
        'CREATE POLICY recdms_app_insert ON %I.%I FOR INSERT TO recdms_app WITH CHECK (true)',
        sch, tbl
      );
    ELSE
      EXECUTE format(
        'CREATE POLICY recdms_app_all ON %I.%I FOR ALL TO recdms_app USING (true) WITH CHECK (true)',
        sch, tbl
      );
    END IF;
  END LOOP;

  EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA %I TO recdms_app', sch);
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO recdms_app',
    sch
  );
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT USAGE, SELECT ON SEQUENCES TO recdms_app',
    sch
  );

  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA %I FROM %I', sch, role_name);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM %I', sch, role_name);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM %I', sch, role_name);
    END IF;
  END LOOP;

  EXECUTE format('REVOKE ALL ON SCHEMA %I FROM PUBLIC', sch);
  EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM PUBLIC', sch);
  EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM PUBLIC', sch);
END $$;
