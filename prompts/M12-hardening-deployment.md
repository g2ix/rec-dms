# M12 — Hardening and deployment

Read first: `docs/SPEC.md` → "Architecture and tech stack", "Security and data privacy", "Data model" (File storage).

## Goal
Deploy the app on Vercel against the USC on-prem server (Postgres, MinIO, Gotenberg, ClamAV) safely, with backups, and prove a full review cycle works in production-like conditions. Keep the move to Supabase or another managed Postgres a config change.

## Tasks
1. USC server stack `deploy/usc-server/docker-compose.yml`: postgres:16 + pgbouncer (transaction mode), minio, custom gotenberg image (from M10, with fonts), clamav (`clamav/clamav`), cloudflared. Volumes on encrypted disks. Healthchecks.
   - **HTTP services (MinIO, Gotenberg)**: no public ports. Publish them through Cloudflare Tunnel hostnames (e.g. `files.` and `pdf.` under a USC-controlled domain) protected by Cloudflare Access service tokens; the app sends the token headers on every request.
   - **Postgres is the hard part**: Vercel functions speak raw TCP to Postgres and cannot use a Cloudflare TCP tunnel (that needs `cloudflared` running on the client side). Before building, present these options to the user with cost and effort, and wait for a choice:
     a. Expose PgBouncer on a USC public IP with TLS required, firewall allowing only Vercel's static egress IPs (requires Vercel's static IP add-on / Secure Compute, paid).
     b. Put an HTTP data proxy in front of the on-prem DB (e.g. Prisma Accelerate with a self-hosted connection, or a small internal API on the USC server reached through the tunnel) — more moving parts.
     c. Use managed Postgres (Supabase) for the app database now, keep files and PDF conversion on-prem through the tunnel. Lowest effort; matches the "shift to Supabase" plan.
   - Document the chosen path in `docs/DEPLOY.md`.
2. Prisma: `DATABASE_URL` (pooled, `?pgbouncer=true&connection_limit=1`) and `DIRECT_URL` (migrations). `prisma migrate deploy` in the Vercel build. Verify the same migrations run unchanged on Supabase (CI job against a Supabase-compatible Postgres image).
3. ClamAV: scan job for each upload (`scanStatus`), block download/submit of INFECTED files, notify the uploader and REC Staff.
4. Security review checklist (write results in `docs/SECURITY.md`): authz on every server action (script that lists all exported server actions and asserts each calls `authorize`), CSRF (Server Actions origin check), security headers (CSP, HSTS, frame-ancestors none), cookie flags, rate limits, 2FA required for REC_STAFF / chairs / admins (TOTP via `otplib`, add if not present), secrets only in env, dependency audit, upload type sniffing (`file-type`), signed URL expiry.
5. Data privacy: data export for a user (their profile, memberships, signatures list) as JSON; retention job that flags closed protocols past `retention.years` (default 3) for REC Staff to archive or delete (no automatic deletion).
6. Backups: nightly `pg_dump` + MinIO mirror to a second disk/off-site, 30-day retention, documented restore drill; run the drill once and record the result.
7. Observability: structured logs (pino), error tracking (Sentry, optional by env), `/api/health` checking DB, storage, Gotenberg.
8. Production E2E: Playwright suite against a staging deployment running the full expedited cycle (Minor → resubmit → Approved) and an exempt cycle, generating and downloading all PDFs.
9. Admin runbook `docs/RUNBOOK.md`: add a user role, change a workflow step, add a new form (upload .docx, schema, map, publish), add holidays, rotate secrets, restore backup, move DB to Supabase (steps).

## Acceptance criteria
- Staging on Vercel completes both E2E cycles against the USC server stack.
- No service on the USC server is reachable except through the documented, restricted path.
- Restore drill restores yesterday's backup into a fresh database and the audit chain verifies.
- `docs/DEPLOY.md`, `SECURITY.md`, `RUNBOOK.md` complete.
