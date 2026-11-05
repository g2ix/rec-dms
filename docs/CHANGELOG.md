# Changelog

## M03 — Audit trail (2026-11-05)

Meaningful actions are appended to `audit_events` in the same transaction as the change. Each row stores the previous row's hash. `pg_advisory_xact_lock` keeps `seq` and the hash chain in one order. `pnpm audit:verify` and `GET /api/internal/audit/verify` report the first broken sequence. A trigger rejects `UPDATE` and `DELETE`. `/admin/audit` filters the log, exports CSV, and shows whether the chain still verifies. `<AuditTimeline protocolId>` is the protocol activity list, with a simplified mode that hides IP, user agent, and account, role, and settings actions.

Sign-up, email verification, sign-in, failed sign-in, sign-out, linking, unlinking, password set and removal, contact email, approval, rejection, and account merge write audit rows. Diffs keep changed fields only. Password hashes, tokens, and 4–8 digit codes are stored as `[redacted]`.

### Deviation from the spec and the M03 prompt

- The append-only trigger was added with account linking. This milestone reinstalls it and indexes actor, protocol, and time.
- `audit.view` is still the bootstrap-admin check. M02's `authorize(user, "audit.view")` is not in the tree yet.
- Role grant, role revoke, permission edits, and settings edits have no mutation yet, so there is nothing to record. Rejection sets `SUSPENDED` and is stored as `user.rejected`. A separate suspend action can use `user.suspended` when it exists.
- The chain badge is computed when the audit page renders. M09's cron will call the internal route and can store that run.

## M01 — Authentication, account linking, and merge (2026-11-05)

People can register, verify a 6-digit code, and sign in with a password, a magic link, or Google. A person can link any number of Google accounts. Signing in with any linked, verified email or Google identity reaches the same account. `usc.edu.ph` addresses (and subdomains) become `ACTIVE`; other addresses stay `PENDING_APPROVAL` and can sign in, with submit actions blocked by `requireActiveUser()`.

Linking an identity that already belongs to someone else offers a merge. The person confirms both accounts in that flow (password or emailed step-up code on each). REC Staff bootstrap admins can merge two users from `/admin/users`. The merge moves accounts, emails, protocol memberships, roles, signatures, notifications, and tasks in one transaction, marks the other user `MERGED`, and appends `user.merged` to the audit hash chain. It refuses when the two users are proponent/adviser and reviewer on the same protocol, and names that protocol.

Creating or joining a protocol stores the contact email and designation on the membership (course, year, and institution for a student; position, unit, and institution for faculty or staff). The last values are suggested next time. Forms bind to the printed designation for that membership.

### Deviation from the spec and the M01 prompt

- The M01 prompt deferred account merge and audit events. This change adds merge, because one person may hold separate faculty and student Google accounts that already exist as two users. The other auth actions are audited in M03.
- `MERGED` is an additional user status. The row is kept and `mergedIntoId` points at the account that remains. Sign-in to the merged row is blocked.
- Rejecting a pending account sets `SUSPENDED`. There is no separate rejected status.
- Minimal `roles`, `user_roles`, `protocols`, `protocol_members`, `signatures`, `notifications`, and `tasks` tables exist so a merge has real rows to move. Later milestones add the rest of their columns.
- Google client id and secret are optional, so the app runs before a Google OAuth client exists. Linking stays explicit: `allowDangerousEmailAccountLinking` is off.
- Until M02, approving users and merging accounts is limited to `BOOTSTRAP_ADMIN_EMAILS`, not a role.
- Protocol affiliation is stored now, ahead of the full protocol wizard in M05.
- After sign-in, and when a signed-in person opens `/`, `/sign-in`, `/sign-up`, or `/verify`, the start page is the default view stored on that sign-in identity (`accounts.default_view` or `user_emails.default_view`), otherwise the last used view (`activeView`), otherwise `/app`. A view may be a role such as `staff` or a same-site path such as `/app/tasks`. A callback to a specific page such as `/app/protocols/123` is still honored. A signed-out visit to `/app` or `/admin` returns through a relative `callbackUrl` only. Suspended sessions are signed out with “Your account is suspended. Contact the REC Secretariat.”

## M00b — Design system and app shell (2026-11-05)

The REC tokens, Light/Dark/System theme, primitives, blur loading, and the signed-in sidebar shell. `/dev/ui` shows every primitive in both themes. Signed-in pages live under `/app`. The sign-in frame is at `/sign-in`.

### Deviation from the spec and the M00b prompt

- Tailwind 4 is configured in `src/app/globals.css` (`@theme`), which is this project's Tailwind config. The default color palette is removed. Spacing, radius, shadow, duration, and easing utilities point at the tokens.
- The kit has no separate `icon-512.png`. The 512 manifest icon is `usc-seal-512.png`.
- Playwright visual baselines are Windows Chromium snapshots. The visual test is skipped on other platforms because text rendering differs.
- The Next.js dev tools indicator is off so it does not cover the gallery.

## M00 — Project setup (2026-11-04)

Next.js 15 app (App Router, TypeScript strict, `src/`) with Tailwind, shadcn/ui, Prisma, Vitest, and Playwright. The home page states what REC-DMS is. `pnpm mailpit` runs Mailpit's Windows binary for SMTP.

### Deviation from the spec and the original M00 prompt

Docker is not available on this workstation, so local development does not use `docker compose`.

- Postgres and files come from the existing Supabase project REC (`oambvjdvxpxsclfvfcja`) through `DATABASE_URL`, `DIRECT_URL`, and the S3 API (`S3_*`). The app does not use `supabase-js`.
- That project's `public` schema already contains another application's tables (users, protocols, audit logs, and the rest) and has row level security disabled. This app uses schema `recdms` and the private bucket `recdms-files`. Test resets refuse to truncate `public` unless the database name ends in `_test`.
- The hosted database is Postgres 17. `docker-compose.yml` is only the USC server deployment and still uses Postgres 16, MinIO, Gotenberg 8, and Mailpit.
- Gotenberg is not checked in this milestone. M10 will add a `PdfConverter` with a Gotenberg implementation and a local `soffice --headless --convert-to pdf` implementation, chosen by `PDF_CONVERTER`.
- Prisma is pinned to 6.19. The current `prisma` tag is an 8.0 release candidate, and Prisma 7 replaces `new PrismaClient()` with a driver adapter.
- The shadcn registry no longer ships a `form` component. `src/components/ui/form.tsx` is the React Hook Form wrapper the milestone asked for.
- `pnpm db:migrate` runs `prisma migrate deploy`. `migrate dev` would offer to reset a non-empty database.
- MinIO's public Windows binary URL returns HTTP 410, so the storage round-trip starts [s3rver](https://github.com/jamhall/s3rver) when `S3_ENDPOINT` is unset. The same client is what talks to Supabase Storage and to MinIO on the USC server. Set `S3_*` in `.env.test` to run the test against a real endpoint.
