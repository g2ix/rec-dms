# Runbook

These are the operator tasks. Process rules (who reviews, how many days, which form) stay in the database. Change them in the admin screens. Do not hard-code a new step in TypeScript.

## Add a role to a person

1. Sign in as REC Staff or a System Admin. Until the first System Admin exists, an address in `BOOTSTRAP_ADMIN_EMAILS` also works. It stops working for this screen once a System Admin exists.
2. Open `/admin/users`, find the account, and choose Manage roles.
3. Choose the role and Grant role. Only a System Admin can grant or revoke System Admin. The account must be active.
4. The grant is audited as `user.role_granted`. The person must set up an authenticator on the next sign-in. Account → Authenticator shows the key and asks for one code.

To remove a role, enter the reason on that role and choose Revoke role. The reason is kept in the audit event `user.role_revoked`. The last System Admin cannot be revoked.

If the role list is empty, run `pnpm db:seed` on that environment. It creates the roles and is safe to run again.

## Add or change a Panel Chair

A panel has one chair. Panel Chair is granted per panel.

1. Sign in as REC Staff or a System Admin and open `/admin/panels`.
2. On the panel, choose Assign a chair, or Change the chair if one is already set.
3. Search for the person if needed, then choose them from the list. The account must be active. If the panel has a chair, enter the reason.
4. Save. The old chair's role ends and the new chair's role starts together, with one `user.role_revoked` and one `user.role_granted` event.
5. New tasks for that panel go to the new chair. Tasks already open stay with the old chair. REC Staff reassign those from the task.

The person must set up an authenticator on the next sign-in. A panel with a chair refuses a second chair on the Manage roles screen. Use the Panels page instead.

## Change a workflow step

1. Open Admin → Workflows and copy the published version to a draft.
2. Change the step, the assignee rule, the deadline, or a transition. Conditions are JSONLogic on the transition.
3. Validate, then publish. Protocols already in flight stay on the version they started. New submissions use the published version.

## Add a form

1. Prepare the official `.docx` with docxtemplater tags. Times New Roman stays as it is in the file.
2. Open Admin → Forms → New. Set the code, title, version, and effective date.
3. Write the schema. Publish it only after validation passes.
4. Upload the `.docx` and the placeholder map on that form (`pnpm templates:check` lists tags that are not mapped).
5. Publish the form. Add its code to the workflow step that should show it.
6. After Gotenberg is deployed, `pnpm fonts:check` confirms Times New Roman is embedded. Spot-check a PDF against the Word file.

## Add a holiday

Admin → Holidays. Working-day deadlines in Asia/Manila skip weekends and these dates. The change applies to deadlines calculated after it is saved.

## Rotate a secret

Do one at a time. Confirm health or a sample request before rotating the next.

**Gotenberg.** Add a new version of `gotenberg-username` and `gotenberg-password` in Secret Manager. Redeploy with `bash deploy/cloudrun/gotenberg.sh`. Put the same values in Vercel `GOTENBERG_USERNAME` and `GOTENBERG_PASSWORD` and redeploy the app. `curl` without the password must still be 401.

**ClamAV.** Add a version of `clamav-token`. Redeploy with `bash deploy/cloudrun/clamav.sh`. Update Vercel `CLAMAV_TOKEN`.

**Cron.** Add a version of `cron-secret`. Update Vercel `CRON_SECRET`. Re-run `bash deploy/cloudscheduler/create-jobs.sh` so the five jobs send the new bearer token. Update the backup job secret `cron-secret` as well (`bash deploy/cloudrun/backup.sh`).

**Database role.** In the Supabase SQL editor:

```sql
ALTER ROLE recdms_app WITH PASSWORD 'a-new-long-password';
```

Update Vercel `DATABASE_URL` (user `recdms_app.<project-ref>`, port 6543). Do not put this password on `DIRECT_URL`. Migrations stay on `postgres.<project-ref>`.

**Auth cookie secret.** Generate a new `AUTH_SECRET` in Vercel and redeploy. Everyone is signed out.

## Restore a backup

Follow `docs/RESTORE.md`. Practice on a fresh project first.

## Redeploy Cloud Run

```bash
export PROJECT=your-project-id
bash deploy/cloudrun/gotenberg.sh
bash deploy/cloudrun/clamav.sh
```

The scripts build from `docker/gotenberg` and `docker/clamav` and print the URL. If the URL changes, update Vercel and redeploy the app. Confirm `GET /api/health`.

## Scale limits

Edit the flags in the scripts and run them again.

| Service | Memory | CPU | Concurrency | Min instances | Max instances | Timeout |
| --- | --- | --- | --- | --- | --- | --- |
| `recdms-pdf` | 2Gi | 1 | 4 | 0 | 3 | 120s |
| `recdms-scan` | 4Gi | 1 | 1 | 0 | 2 | 300s |
| `recdms-backup` | 1Gi | 1 | job | — | one task | 3600s |

Vercel PDF and package routes are capped at 60 seconds in `vercel.json`. They enqueue the conversion. They do not wait out a cold start. The minute cron finishes the PDF and the screen says “PDF ready”.

Do not raise min instances above 0 without a reason. Scale-to-zero is what keeps the ₱500 budget alert meaningful. If PDFs time out in the job, raise Gotenberg max instances from 3 before raising memory.

## Scanner or PDF is down

`/api/health` shows `pdf` or `scan` as `down`. Files stay “Scan pending”. REC Staff can download a pending file. The warning stays on the screen. After 24 hours the administrators get `scan.unavailable`. Fix the Cloud Run service. The next scan job will clear the files. Do not mark them clean by hand.

## Retention

`/admin/retention` lists flagged protocols. Archive or delete is a staff decision. The job will not delete them. The period is the setting `retention.policy` (`years`, default 3, and the closed status labels).
