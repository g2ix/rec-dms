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

The nightly audit check is a `AUDIT_VERIFY` job. It runs from `GET /api/cron/jobs` with `Authorization: Bearer $CRON_SECRET` and calls the same chain verification. `GET /api/internal/audit/verify` is still available for a manual check. Optional `fromSeq` and `toSeq` query parameters limit that check. Both routes stay unauthorized until `CRON_SECRET` is set.

## Notifications cron

`GET /api/cron/jobs` drains due jobs (email, the 07:00 Asia/Manila digest, and the 02:00 audit check). Call it every minute. `GET /api/cron/sla` sends due-soon, overdue, and escalation notices, and lapses revision deadlines. Call it every hour.

`vercel.json` schedules both once a day (23:00 UTC, which is 07:00 in Asia/Manila). Vercel Hobby only allows a daily cron, so that file cannot express a minutely or hourly schedule. Hourly and minutely runs need Vercel Pro, or a cron on the USC server:

```cron
* * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://rec-dms.example/api/cron/jobs
0 * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://rec-dms.example/api/cron/sla
```

In local development, set `CRON_SECRET` and run `pnpm cron` beside `pnpm dev`. Mail goes to Mailpit when `MAIL_DRIVER` is `smtp` (the default). Set `MAIL_DRIVER=resend` and `RESEND_API_KEY` to send through Resend. The From name is USC Research Ethics Committee.
