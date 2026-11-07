# Restore a backup

Backups are custom-format dumps at `gs://<bucket>/db/YYYY/MM/DD.dump.gz`, plus a mirror of the file bucket at `gs://<bucket>/files/`. Restore into a **new** Supabase project. Do not restore over production, and do not restore over the development project `jrgsxhcegqstegpqgbyv`. The script refuses that project ref.

## 1. Create the empty project

Create a Supabase project in Singapore. Copy its session-pooler URL (port 5432, user `postgres.<new-ref>`) into `DIRECT_URL` for this shell only.

## 2. Download one dump

```bash
gcloud storage cp gs://BUCKET/db/YYYY/MM/DD.dump.gz ./recdms.dump.gz
```

## 3. Restore and verify

`pg_restore` and `psql` must be Postgres 17 or newer.

```bash
export DIRECT_URL="postgresql://postgres.<new-ref>:[PASSWORD]@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require"
bash scripts/restore-drill.sh ./recdms.dump.gz
```

The script runs `pg_restore --no-owner --no-acl` and then `pnpm audit:verify`. A good run prints `Chain verified up to #N` and exits 0.

If the chain fails, stop. Do not point the application at that database.

## 4. Files

The dump does not contain object bytes. Copy the mirror into the new project's bucket with rclone or `gcloud storage rsync`, using a new S3 key on the new project:

```bash
rclone sync gcs:BUCKET/files s3new:recdms-files
```

Point `S3_*` at the new bucket before starting the app.

## 5. Application role

On the restored database the role `recdms_app` may already exist without a password. In the SQL editor:

```sql
ALTER ROLE recdms_app WITH LOGIN PASSWORD 'a-new-long-password';
```

Use `recdms_app.<new-ref>` as the pooler user in `DATABASE_URL`. Keep `postgres.<new-ref>` on `DIRECT_URL`.

## 6. Record the drill

Append the date, the dump path, the new project ref (not the password), and the `audit:verify` line to `docs/CHANGELOG.md`.

The drill was not run from this workstation. It needs a fresh Supabase project and the Google Cloud login of the person deploying. Run it once on a dump from staging and paste the result into the changelog.
