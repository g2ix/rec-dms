# Security review

Reviewed with the M12 deployment. This file is the result, not a promise that a later change stays safe. Re-run `pnpm authz:check` and `pnpm test` after any new server action.

## Authorization

`src/lib/authz-surface.ts` lists every exported server action and route handler.

- Protocol, form, workflow, and holiday mutations call `authorize`.
- Sign-in, registration, linking, and the authenticator actions live in `src/server/auth/`. They run before a session exists, or they change only the signed-in account, and they are rate limited where a code or password is checked.
- Reading or dismissing your own notifications, saving your own signature image, and presence on a form you already opened are limited to `requireUser` and the row’s owner. Accepting an invitation is the same: the action only updates an `INVITED` membership already addressed to the signed-in user.
- Cron routes and `GET /api/internal/audit/verify` require `Authorization: Bearer $CRON_SECRET` (`cronAuthorized`). An empty secret rejects every call.
- `GET /api/health` is public and returns no secrets.
- `GET /api/account/export` returns only the signed-in user’s profile, emails, memberships, and signature list.
- Audit CSV uses `assertCanViewAudit`. Report CSV is built for the signed-in user and the role they are allowed to see.

`pnpm authz:check` exits 1 if a new export misses this.

## Headers and cookies

`next.config.ts` sends a content security policy (`default-src 'self'`, the Supabase storage origin, Google Fonts), `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` with camera, microphone, geolocation, and payment disabled, and `X-Content-Type-Options: nosniff`. HSTS is sent when `VERCEL_ENV` is `production`.

The Auth.js session cookie is `httpOnly`, `SameSite=Lax`, and `Secure` in production (`useSecureCookies`). The authenticator session cookie `recdms_totp` uses the same flags. `activeView` is not `httpOnly` because the role switch writes it from the browser. It is `SameSite=Lax` and `Secure` on HTTPS. It does not grant access. The server still checks the session.

## CSRF

Next.js compares the `Origin` of a Server Action to the host. `middleware.ts` rejects a `next-action` request whose origin host is not the request host. In development, `localhost` and `127.0.0.1` on the same port are treated as the same host so Playwright can run.

## Uploads

Confirming an upload reads the bytes with `file-type` and rejects a file whose detected type is not the type that was declared, except the EICAR test string, which is stored so the scanner can mark it infected. Manuscripts and cover letters must be PDF. A fee receipt or supporting file may be PDF, JPEG, PNG, or WebP. The size limit is the `uploads.maxBytes` setting (default 25 MB).

Download URLs expire after 5 minutes (`getSignedDownloadUrl`).

`INFECTED` files cannot be downloaded or submitted. The object is deleted and the uploader and REC Staff are notified. `PENDING` files can be downloaded by REC Staff only, and the screen says the scan has not finished. If the scanner stays unreachable for 24 hours, system administrators are notified and the file stays `PENDING`.

## Authenticator

REC Staff, the REC Chair, Panel Chairs, and System Admins (and a bootstrap administrator, who counts as staff) must enter a TOTP code before the rest of the app will open. The secret is encrypted with AES-GCM under `AUTH_SECRET`. Other people may turn it on from Account → Authenticator. The code is checked with `otplib`, one step of clock skew, and five attempts per five minutes.

## Database

`recdms_app` is `NOLOGIN` until an operator sets the password. It is not a superuser and does not bypass row level security. It has `SELECT`, `INSERT`, `UPDATE`, and `DELETE` on application tables, and only `SELECT` and `INSERT` on `audit_events`. The M03 trigger still rejects `UPDATE` and `DELETE` for every role, including the table owner.

Row level security is enabled on every table in the `recdms` schema. Policies allow `recdms_app` only. There is no policy for `anon` or `authenticated`. The table owner (the migration role) bypasses row level security, which is why migrations and local development as `postgres` still work. A policy for `recdms_app` is required: that role does not own the tables and was not given `BYPASSRLS`. Without the policy, production would see no rows. `anon` and `authenticated` still have no policy and no grants.

`public` is not changed. It belongs to another application on the development project. Production should be a new project. Disable the Data API for schemas this app does not intend to expose, and confirm the anon key returns nothing (`docs/DEPLOY.md`).

## Dependencies and secrets

Secrets are Vercel environment variables and Google Secret Manager entries. They are not written into the repository. Run `pnpm audit` before a release and upgrade anything with a fix available. The last local audit is recorded in `docs/CHANGELOG.md` for this milestone.

Signed URLs, the cron bearer token, Gotenberg basic auth, and the ClamAV bearer token are the credentials in front of the data plane. Cloud Run allows unauthenticated invocations so Vercel can reach the services. The application credential is what rejects a stranger. Do not remove basic auth or the bearer token to “fix” a 401.
