# Deploy REC-DMS

The app runs on Vercel in Singapore (`sin1`). The database and private files are a Supabase project in Singapore, separate from the development project `jrgsxhcegqstegpqgbyv`. PDF conversion and virus scanning are Cloud Run services in `asia-southeast1`. Cloud Scheduler calls the app. A Cloud Run Job dumps the database and mirrors files into a private Cloud Storage bucket in Singapore.

There is no on-prem server and no tunnel. The old compose file is in `deploy/archive/usc-server/` with a note that it is not the deployment.

Do these steps in order. Commands assume a bash shell (Cloud Shell works). Never paste a secret into chat. Create secrets in the console or with `gcloud secrets create`, and read them back only inside the scripts.

## 1. Google Cloud project

```bash
gcloud auth login
gcloud config set project "$PROJECT"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com cloudscheduler.googleapis.com storage.googleapis.com
```

Create a service account `recdms-scheduler@$PROJECT.iam.gserviceaccount.com` and grant it `roles/run.invoker`. The backup script binds it to the job.

## 2. Supabase production project

Create a project in Singapore. Do not reuse the development project.

In the SQL editor, after the first `prisma migrate deploy` has created the tables, set the app role password. The migration creates `recdms_app` as `NOLOGIN` and does not contain a password.

```sql
ALTER ROLE recdms_app WITH LOGIN PASSWORD 'choose-a-long-password';
```

Connection strings, from the Supabase connect panel (the `aws-0` / `aws-1` host depends on the project):

- App, transaction pooler, port 6543: user `recdms_app.<project-ref>`

```text
postgresql://recdms_app.<project-ref>:[PASSWORD]@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1&schema=recdms&sslmode=require
```

- Migrations, session pooler, port 5432: user `postgres.<project-ref>`

```text
postgresql://postgres.<project-ref>:[PASSWORD]@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?schema=recdms&sslmode=require
```

`DATABASE_URL` is the first. `DIRECT_URL` is the second. The Vercel build command is `prisma migrate deploy && next build` (`pnpm vercel-build`), and migrate uses `DIRECT_URL`.

Storage: create a private bucket `recdms-files` and an S3 access key. The endpoint looks like `https://<project-ref>.storage.supabase.co/storage/v1/s3`. Region `ap-southeast-1`. The app default for `uploads.maxBytes` is 100 MB. Supabase’s free plan caps a single file at 50 MB, so production needs a paid plan or a lower setting.

Data API: in Project Settings → Data API, remove `public` from Exposed schemas if that schema is not serving another application. The `recdms` schema must not be exposed. Confirm with the anon key:

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  "https://<project-ref>.supabase.co/rest/v1/settings?select=key"
```

The response must be 401, 404, or an empty error. It must not return setting rows. A Vitest check also `SET ROLE anon` and expects the read to fail when that role exists.

## 3. Secrets in Secret Manager

Create these secrets (the values never go in git):

| Secret | Used by |
| --- | --- |
| `gotenberg-username` | Cloud Run `recdms-pdf` |
| `gotenberg-password` | Cloud Run `recdms-pdf` |
| `clamav-token` | Cloud Run `recdms-scan` |
| `cron-secret` | Cloud Scheduler and the backup stamp |
| `backup-direct-url` | Backup job, session pooler URL |
| `s3-access-key` | Backup job |
| `s3-secret-key` | Backup job |

```bash
printf '%s' "$VALUE" | gcloud secrets create gotenberg-username --data-file=-
```

Use `gcloud secrets versions add` when the secret already exists.

## 4. Cloud Run

From the repository root:

```bash
export PROJECT=your-project-id
bash deploy/cloudrun/gotenberg.sh
bash deploy/cloudrun/clamav.sh
```

Each script prints the service URL. Copy them into Vercel as `GOTENBERG_URL` and `CLAMAV_URL` (no trailing slash).

Check that a request without credentials is rejected:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$GOTENBERG_URL/forms/libreoffice/convert"
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$CLAMAV_URL/scan"
```

Both must be `401`. Gotenberg leaves `GET /health` open so the app can probe it. Conversion still requires basic auth. ClamAV requires the bearer token on `/health` and `/scan`.

Font check, after the URL and basic-auth variables are in the environment:

```bash
pnpm fonts:check
```

It converts `templates/F-26.docx` and fails if the PDF does not embed Times New Roman.

## 5. Vercel

- Framework preset: Next.js. Install command `pnpm install`. Build command `pnpm vercel-build` (or leave the default if `vercel-build` is detected).
- Root directory: the repository root.
- Function region: `vercel.json` pins `sin1`. In the project settings, do not add another region.
- Production environment variables: every row marked required in `docs/ENVIRONMENTS.md`.
- `AUTH_URL` and `APP_BASE_URL` are the production origin, for example `https://rec-dms.example.edu`.
- Do not add Vercel Cron. `vercel.json` has no `crons` key. Cloud Scheduler is the clock, including on the Hobby plan.

After the first deploy, open `/api/health`. `checks.database` should be `ok` and `dbMs` should be under 30 from `sin1`. The route logs that round trip once per instance.

## 6. Schedules

```bash
export PROJECT=your-project-id
export APP_BASE_URL=https://rec-dms.example.edu
bash deploy/cloudscheduler/create-jobs.sh
```

| Job | Schedule, Asia/Manila | Path |
| --- | --- | --- |
| `recdms-cron-jobs` | every minute | `/api/cron/jobs` |
| `recdms-cron-sla` | hourly | `/api/cron/sla` |
| `recdms-cron-digest` | 07:00 | `/api/cron/digest` |
| `recdms-cron-audit` | 02:00 | `/api/cron/audit-verify` |
| `recdms-cron-retention` | Monday 03:00 | `/api/cron/retention` |

A call without `Authorization: Bearer $CRON_SECRET` returns 401. Each route handles a bounded batch and returns.

## 7. Backups

```bash
export PROJECT=your-project-id
export BUCKET=recdms-backups-your-suffix
export APP_BASE_URL=https://rec-dms.example.edu
export S3_ENDPOINT=https://<project-ref>.storage.supabase.co/storage/v1/s3
export S3_BUCKET=recdms-files
export SCHEDULER_SA=recdms-scheduler@$PROJECT.iam.gserviceaccount.com
bash deploy/cloudrun/backup.sh
```

The bucket is in Singapore, uniform access, public access prevented, versioning on, objects deleted after 90 days. The job runs at 01:00 Asia/Manila. It writes `gs://<bucket>/db/YYYY/MM/DD.dump.gz` and syncs the file bucket to `gs://<bucket>/files/`. On success it stamps `ops.backupAt`, which `/api/health` reports.

Run one job immediately:

```bash
gcloud run jobs execute recdms-backup --region=asia-southeast1 --wait
```

Then follow `docs/RESTORE.md` on a fresh Supabase project and record the result in `docs/CHANGELOG.md`.

## 8. Staging

Use a second Supabase project and a Vercel Preview environment with the same Cloud Run services. Seed it with `pnpm db:seed`. Then:

```bash
export STAGING_BASE_URL=https://your-preview.vercel.app
export STAGING_EMAIL=...
export STAGING_PASSWORD=...
export STAGING_PROTOCOL_PATH=/app/protocols/<id>/uploads
export STAGING_FORM_PATH=/app/protocols/<id>/forms/<instanceId>
pnpm test:e2e:staging
```

The suite checks health, rejects a cron call without the secret, signs in, uploads the EICAR test file and expects it to be blocked, and downloads a form PDF. The full expedited and exempt review paths are covered by `src/server/workflow/zz-usc-rec.cycle.test.ts` against the database. Walk the same path once in the browser on staging before calling the release done: Minor modifications, resubmit, Approved, and one exemption.

## 9. Budget and uptime

In Google Cloud Billing, create a budget alert at ₱500 per month on this project and email the system administrator. In Cloud Monitoring, create an uptime check on `GET /api/health` from a Singapore checker, expecting HTTP 200.

## Verify each step

| Step | Check |
| --- | --- |
| Role | As `recdms_app`, `UPDATE audit_events` fails. `pnpm test` includes this. |
| Anon key | The curl above returns no rows. |
| Gotenberg | `curl` without a password is 401. `pnpm fonts:check` passes. |
| ClamAV | `curl` without the token is 401. An EICAR upload ends Blocked. |
| Cron | `curl` without the bearer token is 401. |
| Region | Vercel function logs show `sin1`. Health `dbMs` is under 30. |
| Backup | The job execution succeeds and `/api/health` shows `checks.backup` as `ok` after the stamp. |
