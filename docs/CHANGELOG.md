# Changelog

## M11 — Dashboards and reports (2026-11-06)

Each role view opens on a dashboard of the work that needs attention. The count in each heading is the same number as the task inbox for that view, and it links to the list it counts. REC Staff see the screening queue in arrival order, fee receipts, releases, accounts waiting for approval, and overdue tasks. Chairs see the pipeline by step and review type, overdue work, and turnaround from the completion of staff screening. Panel Chairs see their panel, reviewer load, and overdue work in that panel.

The protocol logbook lists workflow events, releases, notices, and generated documents. Proponents do not see reviewer names there. Reports at `/app/reports` filter by date, panel, review type, status, and submission type, and download as CSV. A Panel Chair’s CSV contains only that chair’s panel. Meetings group protocols that are waiting for a meeting outcome by the next second Friday, and flag a full review that missed the 14-day cutoff. Staff and Chairs can search by protocol code, title words, or proponent name.

Turnaround uses calendar days in Asia/Manila. Expedited is 28 days, full review is 49 days (7 weeks), and exempt is 9 days (2 + 2 + 5). A result on the limit counts as within it. The median of an even sample is the mean of the two middle values. The 90th percentile uses the nearest rank. `pnpm db:seed:load` inserts 5,000 protocols for a timing check (`LOAD_SEED=delete` removes them).

### Deviation from the spec and the M11 prompt

- Screening, release, meeting, and revision steps are recognized from the published workflow (fee check, generated documents, meeting date, and the wait step), so a renamed step still shows up.
- The exempt limit is the 9-day track in the spec. The prompt names the expedited and full-review limits only.
- Approving a pending account is still limited to a bootstrap administrator. REC Staff see the waiting accounts and the link to that screen.
- Activity stays as the short timeline. The logbook is the communications record beside it.
- `pnpm test` checks the 5,000-protocol dashboards inside a transaction that rolls back, so the development database is left as it was.



Filled forms download as the official Word file or as a PDF, and a protocol page can download the submission as one PDF or a ZIP. Printing opens the PDF. A locked form is stored and reused. A form that is still being edited is generated again when its revision changes. Releasing a decision generates F-39. An approved release looks for a Certificate of Approval template and, when it is missing, leaves a warning on the release task.

`PDF_CONVERTER` chooses local LibreOffice or Gotenberg. The server image in `docker/gotenberg` installs Times New Roman. Placeholder maps are seeded, and an administrator can replace a template and its map on a published form. `pnpm templates:check` reports tags and fields that are not mapped.

### Deviation from the spec and the M10 prompt

- Only F-26, F-27, F-28, F-29, F-30, F-35, and F-36 were supplied as Word files. F-31, F-37, F-38, F-39, and F-41 were rebuilt from `docs/forms/source/Updated USC REC Forms.pdf` using the F-26 header. Their page breaks will not match the PDF.
- The Certificate of Approval is not in the source set, so an approval records the warning and still releases the letter.
- F-27's research-type boxes and declaration lines are paired with the shorter lists on the form. The signature line shows the project leader. The footer lists every signer.
- F-29 folds the extra method fields into the last narrative box. F-36 prints the REC Chair where the file says Panel Chair.
- This workstation has no LibreOffice and no `pdftoppm`, so `pnpm templates:visual` skips and no page baselines were saved.

## M09 — Notifications, reminders and escalation (2026-11-06)

People are told about tasks, deadlines, and decisions in the app and by email. The bell in the top bar shows the unread count and the latest ten notices, and polls every 30 seconds. The full list is at `/app/notifications`. Email preferences are at Profile → Notification preferences. Reminders can wait for a digest at 07:00 Asia/Manila. Task assignments and decisions are always sent immediately.

`/api/cron/jobs` (protected by `CRON_SECRET`) runs due jobs with `FOR UPDATE SKIP LOCKED`, retries with backoff, and marks the email failed after five attempts. `/api/cron/sla` sends each due-soon offset, the overdue notice, and the escalation once. A revision wait is reminded 5 and 1 working days before it is due, then lapses. A nightly job checks the audit chain and tells system administrators if it breaks. Templates are seeded and edited at `/admin/notifications`, with a sample preview. `pnpm cron` calls both routes every minute in development. Vercel Hobby can only schedule a daily cron; `docs/DEPLOY.md` says to use Vercel Pro or a cron on the USC server for minute and hour schedules.

### Deviation from the spec and the M09 prompt

- The M05 `notifications` row kept `payload` and `emailed_at`. Title, body, link, protocol, task, and `email_status` were added beside them so earlier notices still load.
- Due-soon and overdue notices are sent by the SLA scan, which records each one on the task. The engine still enqueues assignment, completion, reassignment, and transition notices. It no longer pre-schedules a second copy of the reminder.
- A transition can name a template in `notify`. A return uses that to send `protocol.returned_incomplete` to the project leader.
- The seeded workflows tell the assignee when a task opens, remind one day before a calendar deadline (twelve hours before an hour deadline), and escalate overdue tasks to REC Staff. Revision waits still lapse instead of escalating.
- `audit.chain_broken`, `review.submitted`, and `exemption.not_qualified` are editable templates in addition to the thirteen named in the prompt.
- Invite email still goes out through the existing mailer so the sign-up link is sent even when the person has no account yet. The copy comes from `invite.member`.

## M08 — USC REC seed (2026-11-06)

Initial submission and resubmission now run from published form definitions and workflow versions. `pnpm db:seed` loads the twelve phase-1 forms at version 09-00 (effective 2025-08-01), both workflow graphs, the protocol code pattern `USC-REC-{YYYY}-{####}`, a 30-working-day revision period, REC contact details, and the panel-to-discipline map. `SEED_DEMO=true` also creates one account per role and two sample protocols. Running the seed again refreshes those form schemas and publishes a new workflow version when the graph changed. Protocols already in flight stay on the version they started.

The seed follows the 6 Nov 2026 decisions. The REC Chair determines the review, records the recommended action and justification, and signs the decision. The Panel Chair fills F-41. A protocol that is not qualified for exemption goes back to the project leader and the secretariat is notified. Reviewers are any mix of at least two primary reviewers and independent consultants, and the chair may add more. F-37 copies only the points that have a comment or a suggestion, and those words stay closed. The 30 working days are written onto the notice when staff release it. Extension requests are not in this seed.

The expedited path (minor modifications, resubmission, approval) is covered by `src/server/workflow/zz-usc-rec.cycle.test.ts`. Point counts, the page-and-paragraph steps, and the closed F-37 comments are covered by `src/server/workflow/usc-rec.seed.test.ts`.

### Deviation from the spec and the M08 prompt

- The full-review release step is `staff_release_full` (3 calendar days). Expedited release stays `staff_release` (5 calendar days). A step has one deadline, and both release the same notification.
- While the leader is still preparing the first submission, the status is Draft. Screening then shows Under Screening, so Submitted is not a resting status. A return sets the status to Returned.
- The snapshot runs after staff accept the submission, so an incomplete return can still be edited. Resubmission freezes on `freeze_version` after its own screening accept.
- Resubmission reviewers are the people chosen on the parent instance (`ASSIGNED_IN_STEP` with `source: "parent"`). The same reviewers and no new meeting are the editable default.
- Assessment and budget columns can be `computed`. Required checks apply only to the cells the current role can edit on the current step. A locked form can take a later step's remarks when the application sets `recdms.form_review`; its status stays LOCKED.
- F-29 keeps researcher signatures on the application form. A repeating table cannot store a signature image.
- F-31 records the reviewers on the workflow step, where the chair can add to the list. The form does not also ask for one scientist and one non-scientist.
- The browser test checks the F-35 wording, the phone layout, and that F-37 hides points with no comment. The full expedited cycle is the Vitest above.
- Form schemas are TypeScript modules under `prisma/seed/usc-rec/`. Each one is checked with the M04 schema validator before it is published.
- Submit completes the project leader’s open task on the running initial submission or resubmission. Another workflow on the same version is left alone.
- An automatic step that leads back to itself stops at once, instead of walking the loop until the safety cap.

## M07 — Configurable workflow engine (2026-11-05)

A review runs from a versioned graph. Publishing a new version does not move protocols that already started. The engine opens steps, creates tasks, counts working days in Asia/Manila (skipping weekends and holidays), and writes the audit event in the same transaction. Completing a task that is already complete returns the earlier result. Notifications are rows in `jobs`; nothing is emailed yet.

Admins edit drafts at `/admin/workflows`, validate them, publish them, and walk a simulation. Holidays are kept at `/admin/holidays`. `/app/tasks` lists open tasks for the role being viewed, with due soon and overdue called out in words. A protocol page shows the open step, who holds it, the due date, and the step history.

Submit completes the project leader’s open task on the initial-submission workflow when that workflow is published. Another workflow running on the same version is left alone. Until an initial workflow is published, submit still uses the earlier required-forms and required-uploads settings.

### Deviation from the spec and the M07 prompt

- The M01 `tasks` table was extended in place. `title` stays so account merge still moves those rows. Workflow tasks leave it as the step name. `assignee_user_id` can be empty until someone claims a role task.
- Reviewers chosen on a step are stored on the instance as `assignments`. A later step with `ASSIGNED_IN_STEP` reads that list. They are required only when the chosen outcome moves to that step, so a return does not ask for reviewers.
- Actions carry an optional `hook` of `onEnter` or `onExit`. An automatic step runs its enter actions and then follows the matching transition.
- `SNAPSHOT_VERSION` freezes the working version. A later return to the same step does not freeze it again. Reviewer forms opened after that stay editable while the reviewer’s task is open. Forms locked at submission stay locked.
- No initial or resubmission graph is seeded. That waits for M08. Creating a protocol starts `INITIAL_SUBMISSION` only when a version of it is published. A revision starts `RESUBMISSION` only when that definition is published.
- The builder edits steps, assignee rules, deadlines, forms, outcomes, notifications, and transitions (including a JSON condition). The graph on the right is laid out with dagre and is not dragged.

## M06 — Digital signatures (2026-11-05)

A person saves a signature image from My signature, either drawn on a pad or uploaded as a PNG or JPG. The image is trimmed, the white background is made transparent, and it is stored as a PNG no larger than 600×200. Saving a new image deactivates the previous one and keeps it for forms already signed.

Signing a field asks the person to confirm with their password, or with a 6-digit code when the account has no password. That confirmation lasts 10 minutes and is only for signing. The signature event stores the image version, the form, the protocol version, the time, the IP, the user agent, and a SHA-256 hash of the form data with signature fields removed. The public page `/verify/[ref]` shows the form code, the protocol code when one is assigned, the signer, the time, and whether that hash still matches. It does not show the rest of the protocol.

Editing any other field voids the signatures on that form, writes `form.signature_voided`, and leaves an in-app notice for each signer. The form says the signature is void and must be signed again. Submit stays closed until every required signature on the required forms is signed and not void.

### Deviation from the spec and the M06 prompt

- The stub `signatures.image_key` column stays so earlier rows and the account merge still have a storage key. New images also set `file_id` on `files`. One active image per person is enforced with a partial unique index.
- A signature field names its signer with `signer.role`. Proponent signatures set `signer.each` to `researchers`, which creates `signatures.researchers[0]`, `signatures.researchers[1]`, and so on in roster order. An adviser field such as `adviser_signature` is signed by the adviser member. A signature counts as required when the field says `validation.required`.
- Signing confirmation is stored on `signing_step_ups`. It is separate from the confirmation used to merge accounts.
- `/verify` is still the email-code page. `/verify/[ref]` is the public signature check and does not send a signed-in person back to the app home.
- Void notices are rows in `notifications` only. Email for that notice waits for M09.
- The processed signature PNG is marked `CLEAN` because the server re-encoded it. The original upload is not kept.

## M05 — Protocols, collaboration, uploads, versions (2026-11-05)

A proponent can open a protocol, invite co-proponents and an adviser, fill shared details once, edit the working forms together, upload the manuscript, cover letter, and fee receipt, and submit a version. The creator is the project leader. A discipline suggests a panel. REC Staff (a bootstrap administrator until role grants exist) can change the panel and verify or reject a receipt.

Submitting locks that version’s forms and snapshot. A later revision copies the forms into a new working version. Two people can save different fields of the same form from the same revision; the same field shows who changed it. An invitation to an email that has no account attaches when that email is verified.

### Deviation from the spec and the M05 prompt

- M02’s role and permission tables are still not in the tree. `authorize` reads real protocol memberships for protocol actions. Form administration and committee staff actions still allow bootstrap administrators, and also a user who already holds `REC_STAFF`, `REC_CHAIR`, `PANEL_CHAIR`, or `SYSTEM_ADMIN`.
- Signatures are collected in M06, so a form that is otherwise valid shows “Needs signatures” and submit does not wait for them.
- Until M07, submit sets the protocol status to `SUBMITTED` and starting a revision sets it back to `DRAFT`. The workflow will own status after that. The working version has no workflow step, so a field limited to a named step stays closed.
- Research type, duration, participants, study site, and funding sources are stored on the protocol. The checkbox lists from F-27 arrive with the M08 form seed. The title warns when it is all capitals and can still be saved.
- Direct-to-storage uploads use a short-lived `upload_intents` row so the browser cannot choose the storage key. Virus scan stays `PENDING`.
- `File` is the Prisma model `StoredFile` (table `files`) so it does not clash with the DOM `File` type. A submitted version and a locked form instance reject later writes in the database as well as in the service.
- A protocol that has no version yet (for example one created before this milestone) offers “Start the working version”. That opens version 1. “Start a revision” is the label once a version has already been submitted.

## M04 — Form engine (2026-11-05)

Forms are data. An admin writes a schema, sees it render beside the JSON, publishes it, and fills a sandbox copy. Each field save checks who may edit it at the current step, validates the value, recalculates computed fields, and appends `form.field_saved` to the audit chain. A stale revision returns the value now stored and who wrote it.

The sample form covers a short title, a yes/no/not-applicable question that asks for a reason, a budget table with a computed total, and an assessment table whose Proponent and Reviewer columns belong to different roles.

### Deviation from the spec and the M04 prompt

- M02's `authorize` is not in the tree yet. `src/server/authz/index.ts` allows `forms.view`, `forms.edit`, and `forms.fill` for bootstrap administrators. M02 should switch that check to the `forms.edit` permission.
- A sandbox copy stores `preview_roles` and `preview_step` on the instance. The try page sets them with an authorized action, and each save reads them back, so the browser cannot choose a role on the save itself. Protocol copies ignore those columns.
- `FormInstance` uses `owner_type` and `owner_id` so a sandbox has an owner before protocol versions exist. `PROTOCOL_VERSION` is the owner type submissions will use.
- Rich text is a plain text area. Signature and file reference are read-only notes until signing and uploads land. Amounts are stored as integer centavos and typed in pesos.
- `@monaco-editor/react` and `json-logic-js` were added because this milestone asks for a Monaco JSON editor and JSONLogic conditions.

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
