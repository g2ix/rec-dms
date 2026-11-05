# Deployment notes

Local development uses the Supabase project in `.env.local`. This file is the USC server checklist. `docker-compose.yml` is that deployment (Postgres 16, MinIO, Gotenberg, Mailpit).

## Audit log privileges

`audit_events` is append-only. The migration `20261105140000_audit_hardening` installs `recdms_reject_audit_mutation`, which rejects every `UPDATE` and `DELETE`, including statements from the table owner. Truncate and disabling the trigger still require a role that can alter the table. The application role must not be that role.

Run the grants as the migration owner after `pnpm db:migrate`. Replace `recdms_app` with the role named in the server's `DATABASE_URL`. Do this in the `recdms` schema only. Leave `public` alone.

```sql
CREATE ROLE recdms_app LOGIN PASSWORD 'replace-me';
GRANT USAGE ON SCHEMA recdms TO recdms_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA recdms TO recdms_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA recdms TO recdms_app;

REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE recdms.audit_events FROM recdms_app;
GRANT SELECT, INSERT ON TABLE recdms.audit_events TO recdms_app;
GRANT USAGE, SELECT ON SEQUENCE recdms.audit_events_seq_seq TO recdms_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA recdms
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO recdms_app;
```

Point the app at `recdms_app`. Keep a separate owner role for Prisma migrations. The owner can disable the trigger; the app role cannot.

Check the chain from the server with `pnpm audit:verify`. It prints `Chain verified up to #N` or exits 1 with `Chain broken at #N`.

The hourly job in M09 calls `GET /api/internal/audit/verify` with `Authorization: Bearer $CRON_SECRET`. Optional `fromSeq` and `toSeq` query parameters limit the check. The route stays unauthorized until `CRON_SECRET` is set.
