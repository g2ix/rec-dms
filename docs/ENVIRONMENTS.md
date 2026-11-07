# Environments

Values live in `.env.local` on a workstation, in the Vercel project for Preview and Production, and in Google Secret Manager for Cloud Run. Nothing secret is committed. `.env.example` lists the names with empty secrets.

`PDF_CONVERTER=soffice` is still accepted and means the same thing as `libreoffice-local`.

Production (`VERCEL_ENV=production`) refuses to boot if `CRON_SECRET`, `APP_BASE_URL`, `CLAMAV_URL`, `CLAMAV_TOKEN` are empty, and if `PDF_CONVERTER=gotenberg` without `GOTENBERG_URL`, `GOTENBERG_USERNAME`, and `GOTENBERG_PASSWORD`. Preview and local development leave those optional so a workstation without Docker still starts.

| Variable | Development | Preview | Production | Where the value comes from | Secret |
| --- | --- | --- | --- | --- | --- |
| `DATABASE_URL` | Dev Supabase transaction pooler, port 6543, user `postgres.<ref>`, `?pgbouncer=true&connection_limit=1&schema=recdms` | Staging Supabase, same shape, user `recdms_app.<ref>` | Production Supabase, user `recdms_app.<ref>` | Supabase connect panel | Yes |
| `DIRECT_URL` | Dev session pooler, port 5432, user `postgres.<ref>` | Staging session pooler, user `postgres.<ref>` | Production session pooler, user `postgres.<ref>` | Supabase connect panel. Migrations and `pg_dump` only | Yes |
| `AUTH_SECRET` | Long random string | Different random string | Different random string | Generate locally. Vercel env | Yes |
| `AUTH_URL` | `http://localhost:3000` | Preview origin | Production origin | The site’s public URL | No |
| `APP_BASE_URL` | Empty (falls back to `AUTH_URL`) | Preview origin | Production origin | Same origin as `AUTH_URL` | No |
| `S3_ENDPOINT` | Dev project storage S3 URL | Staging storage S3 URL | Production storage S3 URL | Supabase Storage → S3 | No |
| `S3_BUCKET` | `recdms-files` | `recdms-files` | `recdms-files` | Bucket name | No |
| `S3_ACCESS_KEY` | Dev S3 key | Staging S3 key | Production S3 key | Supabase S3 access key | Yes |
| `S3_SECRET_KEY` | Dev S3 secret | Staging S3 secret | Production S3 secret | Shown once at creation | Yes |
| `S3_REGION` | `ap-southeast-1` | `ap-southeast-1` | `ap-southeast-1` | Supabase region | No |
| `PDF_CONVERTER` | `libreoffice-local` | `gotenberg` | `gotenberg` | Chosen per environment | No |
| `GOTENBERG_URL` | Empty, or a tunnel you run yourself | Cloud Run `recdms-pdf` URL | Cloud Run `recdms-pdf` URL | `deploy/cloudrun/gotenberg.sh` prints it | No |
| `GOTENBERG_USERNAME` | Empty | Same as Secret Manager `gotenberg-username` | Same | You choose it, then copy into Vercel | Yes |
| `GOTENBERG_PASSWORD` | Empty | Same as `gotenberg-password` | Same | You choose it | Yes |
| `GOTENBERG_SECRET` | Empty | Leave empty | Leave empty | Legacy `user:password` if username is empty | Yes |
| `CLAMAV_URL` | Empty | Cloud Run `recdms-scan` URL | Cloud Run `recdms-scan` URL | `deploy/cloudrun/clamav.sh` | No |
| `CLAMAV_TOKEN` | Empty | Same as `clamav-token` | Same | You choose it | Yes |
| `SMTP_URL` | `smtp://127.0.0.1:1025` (Mailpit) | Provider SMTP URL | Provider SMTP URL | Mailpit locally. Resend or the USC relay later | Yes, when it contains a password |
| `EMAIL_FROM` | `USC REC-DMS <noreply@localhost>` | A verified from-address | A verified from-address | The mailbox you send as | No |
| `MAIL_DRIVER` | `smtp` | `smtp` or `resend` | `resend` or `smtp` | Chosen per environment | No |
| `RESEND_API_KEY` | Empty | Resend key if that driver is used | Resend key if that driver is used | Resend dashboard | Yes |
| `APP_TIMEZONE` | `Asia/Manila` | `Asia/Manila` | `Asia/Manila` | Fixed | No |
| `GOOGLE_CLIENT_ID` | Optional | OAuth client | OAuth client | Google Cloud console | No |
| `GOOGLE_CLIENT_SECRET` | Optional | Matching secret | Matching secret | Google Cloud console | Yes |
| `BOOTSTRAP_ADMIN_EMAILS` | Your email, if you need the first admin | Staging admin emails | Production admin emails | You choose the list | No |
| `CRON_SECRET` | Any string if you run `pnpm cron` | Same value as Secret Manager `cron-secret` | Same | You choose it | Yes |
| `SENTRY_DSN` | Empty | Optional | Optional | Sentry project settings | Yes |
| `LOG_LEVEL` | `info` | `info` | `info` | Chosen | No |
| `SOFFICE_PATH` | Optional path to `soffice` | Unset | Unset | Local install | No |

Cloud Run reads its own copies from Secret Manager (`GOTENBERG_API_BASIC_AUTH_USERNAME`, `GOTENBERG_API_BASIC_AUTH_PASSWORD`, `CLAMAV_TOKEN`, `DIRECT_URL`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `CRON_SECRET`). Those names are the service’s names, not extra Vercel variables.

Preview deployments that should behave like staging need the same required production set. A pull-request preview that only needs the app to build can omit the Cloud Run variables; the process check is enforced when `VERCEL_ENV` is `production`.
