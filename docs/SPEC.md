# USC REC-DMS — System Design Specification

Nov 4, 2026 · @Gran

## Overview

REC-DMS replaces the email-and-Word submission process of the USC Research Ethics Committee with one web system. Proponents fill the REC forms once, reviewers assess inside the system, and every step is tracked, signed and logged.

**Goals**

- Proponents enter shared data (title, researchers, contacts, institution) once; every form reuses it.
- The review process lives in the database as a configurable workflow, not in code. REC can change steps, actors and deadlines without a developer.
- Forms are defined in the database too, so new forms can be added later.
- Every form prints in the exact layout of the official USC REC .docx templates, as DOCX, PDF or browser print.
- Each action, signature and file is recorded in a tamper-evident audit trail.
- Responsible people are notified when a step reaches them and when it is overdue.

**Phase 1 scope**

- Submission types: Initial Submission and Resubmission (revision after Minor/Major Modifications).
- Review tracks: Exempt, Expedited, Full (outcome of the meeting recorded only).
- Forms: F-26, F-27, F-28, F-29, F-30, F-31, F-35, F-36, F-37, F-38, F-39, F-41.
- Uploads: cover letter, research proposal/manuscript PDF with appendices, proof of processing-fee payment.

**Later phases**: continuing review, amendments, deviations, SAE/SUSAR, early termination, final report, appeals (via the form and workflow builder); meeting management (agenda, attendance, quorum); PNPKI certificate signatures.

**Stack decisions**: Next.js on Vercel; PostgreSQL on a USC server first, portable to Supabase or another managed Postgres; a Gotenberg (LibreOffice) Docker service on the USC server for DOCX-to-PDF conversion.

## Users, roles and accounts

One person = one account, reachable through several linked sign-in identities, holding several roles at once.

**Account linking**

- Sign-in methods: Google OAuth, email + password, email magic link. Microsoft OAuth can be added for USC Office 365 accounts.
- A user can link any number of identities (e.g. a usc.edu.ph Google account and a personal Gmail) to the same account from their profile. Linking requires being signed in to both; an email identity must be verified first.
- Each linked email can be marked as the contact email for notifications.
- Auth library: Auth.js (NextAuth v5) with the Prisma adapter, which stores identities in an `accounts` table separate from `users`.

**Registration**

- Anyone can self-register. Accounts with a verified `@usc.edu.ph` email are active immediately.
- Other emails (external researchers, outside advisers) are `PENDING_APPROVAL` until REC Staff approves them. Pending users can sign in and draft, but cannot submit.

**Roles**

Roles are rows in the database, not an enum, so REC can add roles later. Seed roles:

| Role | Scope | Main actions in phase 1 |
| --- | --- | --- |
| Proponent | per protocol | Creates protocols, fills proponent forms, uploads files, signs |
| Project Leader | per protocol | A proponent flagged as leader; the only one who can submit and resubmit |
| Adviser | per protocol | Signs F-29 verification; reviews F-38 actions taken |
| REC Staff / Secretariat | global | Completeness check, protocol code, fee verification, user approval, release of decisions |
| REC Chair | global | Oversight; actions assigned by workflow |
| Panel Chair | per panel | Review type (F-31), reviewer assignment, F-37 consolidation, F-39 / F-41 signing (as configured) |
| Primary Reviewer | per protocol | Fills reviewer columns of F-35, F-36 and remarks in F-38 |
| Independent Consultant | per protocol | Same as Primary Reviewer, external expert |
| REC Member | global | Full-review deliberation (recorded only in phase 1) |
| Member Secretary | global | Reviews the F-37 / F-38 summary before the Chair (full review) |
| System Admin | global | Users, roles, forms, workflows, settings |

- A global role is held by the user; a per-protocol role is held through a protocol membership; a per-panel role is held through a panel membership.
- The same person can be Proponent on one protocol, Adviser on another and Reviewer on a third. The system blocks anyone from reviewing a protocol they are a member of (conflict of interest).

**Role switching**

- A role switcher in the top bar lists the user's active roles. Switching changes the dashboard, navigation and task inbox to that role's view, without signing out.
- A combined "All my tasks" inbox shows pending tasks across every role, each tagged with the role it belongs to.
- Authorization is always checked on the server against the user's actual role assignments, never against the selected view.

## Current USC REC process

This is what the attached documents say today; it becomes the seed data for the workflow and form engines. Where documents disagree (REC Chair in the flowcharts vs Panel Chair in F-31, F-39, F-41), the actor is a workflow setting, not a code decision.

**Review tracks** (General Flow Chart of REC Procedures)

| Track | When used | Time limit | Steps (actor, deadline) |
| --- | --- | --- | --- |
| Exempt | No human participants or identifiable data; no more than minimal risk | 2 + 2 + 5 days | Submit → Staff completeness check (2 d) → Chair exemption decision via F-41 and signs letter (2 d) → Staff report, communicate, log (5 d) → Proceed |
| Expedited | Minimal risk, no vulnerable groups, does not generate vulnerability | 28 calendar days from complete documents | Submit → Staff check (2 d) → Chair sets type, assigns 2 reviewers or IC (2 d) → Reviewers acknowledge (48 h), fill F-35, F-36, F-37, F-38 (14 d) → Chair finalizes decision (3 d) → Staff prepares decision documents, releases (5 d) → Proponent acknowledges or conforms → Staff files, adds to next meeting agenda |
| Full | Greater than minimal risk, vulnerable groups, or generates vulnerability | 7 weeks; submit complete at least 14 days before the meeting | Submit → Staff check (2 d) → Chair sets type, assigns reviewers, sends package to members (2 d) → Members acknowledge (48 h), reviewers assess (14 d) → Regular meeting, 2nd Friday of the month → Reviewers finalize F-37, F-38 (2 d) → Member Secretary reviews (3 d) → Chair finalizes (3 d) → Staff releases (3 d) → Proponent → Staff files |

**Decisions** (F-35, F-36, F-39): Approved · Minor Modifications Required · Major Modifications Required · Disapproved. Exemption (F-41): Qualified · Not Qualified. Revisions are due within 30 working days of the decision; the proponent can request an extension from the Panel Chair within that period.

**Review panels** (Guide to USC REC Forms): Panel 1 Management, Education, Political Science, Law, Economics, Accountancy · Panel 2 Engineering, Architecture, Fine Arts, Psychology, SoAn, other social sciences · Panel 3 Natural Sciences and Health Sciences. The proponent picks a discipline, the system suggests the panel, and REC Staff or the Chair can change it.

**Forms and who fills what**

| Form | Title | Filled by |
| --- | --- | --- |
| F-26 | Document Receipt Form | Staff (system pre-checks from uploads) |
| F-27 | Research Protocol Application Form | Proponents; all sign |
| F-28 | Data Privacy Consent Form | Proponents; all sign |
| F-29 | Capsule Proposal | Proponents; adviser verifies and signs |
| F-30 | Detailed Budget Sheet | Proponents |
| F-31 | Form on Determining the Type of Review | Chair (Panel or REC, per workflow) |
| F-35 | Protocol Review Assessment Form | Proponents: page/paragraph; reviewers: assessment, comments, recommended action |
| F-36 | Informed Consent Form Assessment Checklist | Same split as F-35 |
| F-37 | Summary of Reviewers' Comments | Consolidated by Panel Chair (configurable) |
| F-38 | Summary of Actions Taken | Proponents: actions + page/paragraph; adviser reviews; reviewers: remarks |
| F-39 | Notification of REC Decision | Panel Chair signs; Staff releases |
| F-41 | Checklist for Exemption from Ethical Review | Panel Chair |

The research proposal/manuscript (with ICF, instruments, online-form screenshots, permissions and CVs as appendices) and the cover letter stay as uploaded PDFs. F-35 and F-36 page/paragraph references point into that PDF.

**Protocol code**: assigned by REC Staff on acceptance, default pattern `USC-REC-{YYYY}-{####}`, editable in settings. Revisions carry version numbers like `2/28May2022` (version/date of revision).

## Architecture and tech stack

One Next.js application on Vercel holds all logic; the USC server holds the data and the PDF converter, reached only through an encrypted tunnel.

*(Diagram: the Next.js app on Vercel — web UI, server actions, workflow engine, document filler, hourly cron — talks to Google OAuth and the email provider, and reaches the USC server (PostgreSQL + PgBouncer, MinIO storage, Gotenberg, ClamAV) only over a locked-down link.)*

The workflow engine is the core: every server action that changes a protocol goes through it and writes an audit event in the same transaction.

| Layer | Choice | Why |
| --- | --- | --- |
| Framework | Next.js 15 (App Router), TypeScript, React Server Components, Server Actions | One codebase for UI and API; deploys on Vercel |
| UI | Tailwind CSS, shadcn/ui, React Hook Form + Zod | Accessible components; schema-driven forms |
| Auth | Auth.js v5 + Prisma adapter | Multiple linked identities per user |
| Database | PostgreSQL 16 via Prisma ORM; PgBouncer | Portable: same schema runs on USC server, Supabase or any managed Postgres; switching = change `DATABASE_URL` |
| Storage | S3 API (MinIO now; Supabase Storage or S3 later) | Same code across hosts |
| Documents | docxtemplater + image module; Gotenberg 8 | Exact .docx layout; faithful PDF |
| Jobs | Vercel Cron + a `jobs` table (outbox) | Reminders and emails retried safely |
| Email | Resend or SMTP via Nodemailer | Behind one interface |
| Testing | Vitest (unit), Playwright (end-to-end) | Workflow engine must be fully tested |

To stay portable, the app uses no Supabase-only features (no RLS-based auth, no Supabase client in business logic).

## Configurable workflow engine

The review process is data: a versioned graph of steps and transitions stored in Postgres, run by a small state-machine engine. Admins edit it in a builder screen; no step, actor or deadline is hard-coded.

**Concepts**

- **Workflow definition**: one per submission type (Initial, Resubmission; later Amendment, Continuing Review…). Has versions; only one version is `PUBLISHED` at a time.
- **Step**: a unit of work. Fields: key, name, type, assignee rule, deadline, forms to fill or sign, required uploads, notification templates.
- **Step types**: `TASK` (one assignee completes it) · `PARALLEL_TASK` (several assignees, e.g. 2 reviewers; completes when all or N finish) · `DECISION` (assignee picks an outcome that drives routing) · `SIGNATURE` (assignee signs listed form instances) · `AUTO` (system action: assign code, generate PDF, send notice) · `WAIT_PROPONENT` (clock runs against the proponent, e.g. 30 working days to revise) · `END`.
- **Transition**: from-step → to-step with a condition on step outcome or protocol fields, e.g. `outcome == "EXPEDITED"`, `reviewType == "FULL"`, `decision in ["MINOR","MAJOR"]`. Conditions are stored as JSON (JSONLogic), evaluated by the engine.
- **Assignee rule**: who gets the task. Options: a role (`REC_STAFF`), the panel's chair (`PANEL_CHAIR_OF_PROTOCOL`), the REC Chair, the protocol's project leader, the protocol's adviser, users picked in an earlier step (`ASSIGNED_REVIEWERS`), or a specific user. This is where "REC Chair or Panel Chair" is settled, per step, by the admin.
- **Deadline**: amount + unit (`HOURS`, `CALENDAR_DAYS`, `WORKING_DAYS`) + optional reminder offsets (e.g. 1 day before) + escalation target. Working days skip weekends and a holiday table.
- **Instance**: a protocol submission running a specific published version. In-flight submissions stay on the version they started with; new submissions use the latest.

**Engine rules**

- Every move is one database transaction: close task, record outcome, evaluate transitions, open next tasks, write audit events, queue notifications.
- Steps with `SIGNATURE` or form requirements cannot complete until those forms are valid and signed.
- Staff can return a submission to the proponent at the completeness-check step ("incomplete"); that is a transition like any other.
- Admins can reassign an open task (e.g. reviewer unavailable); the reassignment is audited.
- A validator in the builder blocks publishing a version with unreachable steps, steps with no exit, or decisions with an unhandled outcome.

**Seed workflow (Initial Submission)**, from the flowcharts: Proponent submits → Staff completeness check and fee verification (2 d; returns if incomplete) → AUTO assign protocol code → Chair fills F-31: exempt, expedited or full; assigns reviewers (2 d) → branch:

1. Exempt: Chair fills F-41 and signs exemption notice (2 d) → Staff releases (5 d) → End.
2. Expedited: Reviewers acknowledge (48 h), then fill F-35 / F-36 (14 d, parallel) → Panel Chair consolidates F-37 and decides (3 d) → Staff releases F-39 (5 d) → branch on decision.
3. Full: same reviewer step → Staff records meeting outcome (scheduled for the 2nd Friday) → Reviewers finalize F-37 (2 d) → Member Secretary reviews (3 d) → Chair finalizes (3 d) → Staff releases F-39 (3 d) → branch on decision.

Decision branch: Approved → certificate released, proponent conforms → End. Minor/Major → `WAIT_PROPONENT` 30 working days → Resubmission workflow (proponent revises protocol, fills F-38, adviser reviews, reviewers add remarks, Chair decides). Disapproved → End.

*(Diagram: Proponent submits → Staff screening (returned if incomplete) → Chair fills F-31 → Exempt (F-41, notice) / Expedited (2 reviewers, F-37) / Full (reviewers, meeting, Member Secretary, F-39) → Decision: Approved (certificate) / Minor or Major (revise within 30 working days, resubmit with F-38, back to reviewers) / Disapproved (ends).)*

Every box and arrow here is a row of seed data in the workflow version, so REC can change any of them in the builder.

## Dynamic forms and exact-layout printing

A form is two linked things: a **schema** (fields, stored as JSON) that drives the web form, and the **official .docx template** with placeholders that drives printing. Adding a form later = upload its .docx, define its schema in the builder, map fields to placeholders.

**Form definition**

- Code (`F-27`), title, version (`09-00`), effective date, and a status (draft, published, retired). Old versions stay so past submissions print as they were.
- Schema: sections and fields. Field types: text, long text, rich text, number, money, date, single choice, multiple choice (checkbox list), yes/no/NA, repeating table (e.g. budget rows, researcher roster), signature, file reference, computed (sum, total).
- Each field has a **who-fills** setting (proponent, reviewer, chair, staff, adviser) and a **when-editable** setting (which workflow steps). F-35 uses this: proponents edit the page/paragraph column only before submission; reviewers edit the assessment columns only during their review step.
- **Shared fields** bind to the protocol record (title, version, researchers, contacts, emails, institution, protocol code). They are entered once and shown read-only, pre-filled, in every form. This removes the repeated header entries across F-26 to F-41.
- Validation rules: required, required-if (e.g. COI details when "has conflict" is ticked), "NA allowed with explanation" (Capsule Proposal rule), min/max.
- Repeating reviewer forms: one F-35 and F-36 instance per reviewer; F-37 shows them side by side for the Chair to consolidate.

**Printing (exact layout)**

1. REC provides the original .docx of each form. A developer adds placeholders once (e.g. `{protocol.title}`, `{#researchers}{name}{/researchers}` for loops, `{%signature_leader}` for images) using docxtemplater syntax; headers, tables, fonts (Times New Roman 12) and the REC header block stay untouched.
2. **DOCX**: the Next.js server fills the template with docxtemplater (+ image module for signatures, checkbox glyphs ☑/☐ for choices).
3. **PDF**: the filled DOCX is sent to the Gotenberg service (LibreOffice in Docker) on the USC server, which returns a PDF with the same layout.
4. **Printable**: the PDF opens in the browser's viewer for printing, so print matches the PDF exactly.
5. Generated files are stored with a SHA-256 hash and the form instance version they came from; a re-print of the same version returns the stored file.

Since Gotenberg runs on-prem and Vercel calls it over the internet, it is exposed only through HTTPS with a shared secret (or a Cloudflare Tunnel), and accepts requests only from the app.

**Bundle export**: "Download submission package" merges the forms in the order the REC guide prescribes (F-26, cover letter, F-27, F-28, F-29, F-35, F-36, F-30, manuscript) into one PDF, plus a ZIP of the individual files with the official file names (REC asks that form file names not be changed).

## Protocol lifecycle and collaboration

A protocol is the long-lived record; each submission is one pass through a workflow; each version freezes what was submitted.

**Statuses** (derived from the workflow, shown to users): Draft → Submitted → Under Screening → Returned (incomplete) → Under Review → Decision Released → Awaiting Revision → Resubmitted → Approved / Exempted / Disapproved / Lapsed (revision deadline passed) / Withdrawn.

**Collaboration**

- The creator becomes Project Leader and invites co-proponents and the adviser by email. Invitees without accounts get a sign-up link; the invite binds to whatever account they sign in with.
- All proponents can edit the drafts at the same time. Phase 1 uses field-level autosave with optimistic locking: each field save carries its last-known revision; a conflicting save shows "changed by Juan D. Cruz a moment ago" with both values. Live co-editing (Yjs) is a later enhancement for long text fields.
- Presence indicator shows who else is on the form.
- Only the Project Leader can submit, resubmit, or withdraw. The leader can transfer leadership to another proponent (audited).
- Submit is blocked until: all required forms valid; all required signatures present (all proponents on F-27, F-28; adviser on F-29); required uploads present; fee receipt uploaded.

**Versioning**

- On submit, every form instance and upload is snapshotted as protocol version N (immutable). Reviewers always see a fixed version.
- On resubmission, the proponent edits a new working copy; the system offers a side-by-side diff of form fields between versions, and requires F-38 (actions taken, per reviewer comment, with page and paragraph).
- Uploaded manuscript revisions must be named with version and date (REC rule); the system suggests the name.

**Fee**: proponent uploads the receipt; REC Staff marks it verified or rejected (with reason) during screening. F-26 item 13 is ticked from that status.

## Signatures, audit trail and notifications

**Digital signature (phase 1)**

- Each user stores a signature image in their profile: drawn on a pad or uploaded (PNG/JPG, background removed or transparent). Changing it creates a new version; old signatures stay attached to what they signed.
- Signing a form: the user re-confirms (password, or a 6-digit code emailed for OAuth users), then the system records a signature event: user, signature image version, form instance, protocol version, timestamp, IP, user agent, and a SHA-256 hash of the form's field data at that moment.
- Editing a signed form after signing invalidates the signature (hash no longer matches) and the form shows "signature void, re-sign required".
- The printed form shows the signature image in place, plus a small footer line: "Signed electronically by Juan D. Cruz, 2026-11-04 14:32 PHT, ref 8F3A…". The reference resolves on a public verify page that confirms the hash.
- Later: PNPKI certificate signatures on the final PDF, added as another signature method without changing the event model.

**Audit trail**

- An append-only `audit_events` table: actor, acting role, action, entity type and id, protocol id, before/after JSON diff, IP, user agent, timestamp.
- Tamper evidence: each row stores the hash of the previous row plus its own content (hash chain). A nightly job verifies the chain and alerts the admin on a break. The app's database role has INSERT and SELECT only on this table.
- Events cover: sign-in, account linking, role changes, form edits (field-level), uploads and downloads, signatures, every workflow transition, reassignments, notifications sent, settings and workflow/form definition changes.
- Views: per-protocol timeline (visible to proponents in a simplified form), and an admin search with filters and CSV export. This doubles as the "Logbook of Communications" in the flowcharts.

**Notifications**

- Channels: in-app (bell + inbox) and email. Each workflow step defines which template fires on: task assigned, due soon, overdue, returned, decision released.
- Recipients come from the step's assignee rule plus configurable CCs (e.g. REC Staff cc'd when reviewers submit, as in the flowchart).
- SLA job: a scheduled job (Vercel Cron every hour) finds tasks due soon or overdue, sends reminders, and on overdue notifies the step's escalation target. Dashboards show overdue tasks in red.
- Email via a transactional provider (Resend or the USC SMTP relay), templates editable in the admin screen. Users can choose immediate or daily-digest email for non-urgent items; task assignments are always immediate.

## Data model

About 30 tables in five groups, managed with Prisma migrations. All ids are UUIDs; all tables carry `created_at`, `updated_at`; soft delete only where noted. JSON columns use Postgres `jsonb`.

| Group | Table | Key columns | Notes |
| --- | --- | --- | --- |
| Identity | `users` | name parts (first, MI, family), status (ACTIVE, PENDING\_APPROVAL, SUSPENDED), primary\_email | One per person |
| Identity | `accounts` | user\_id, provider, provider\_account\_id | Linked sign-in identities (Auth.js) |
| Identity | `user_emails` | user\_id, email, verified\_at, is\_contact | Several emails per user |
| Identity | `sessions`, `verification_tokens` |  | Auth.js |
| Identity | `roles`, `user_roles` | role key, scope (GLOBAL, PANEL, PROTOCOL); user\_id, role\_id, panel\_id? | Global and panel roles |
| Identity | `signatures` | user\_id, version, image blob key, active | Versioned signature images |
| Org | `panels` | name, disciplines\[\], chair user via user\_roles | Panel 1–3 |
| Org | `institutions`, `disciplines` |  | Lookups; external institutions allowed |
| Protocol | `protocols` | code, title, discipline, panel\_id, review\_type, status, leader\_id | Shared header fields live here |
| Protocol | `protocol_members` | protocol\_id, user\_id, role (PROPONENT, ADVISER, REVIEWER, IC), order, invited\_email | Order = roster order; leader first |
| Protocol | `protocol_versions` | protocol\_id, number, label (e.g. 2/28May2022), submitted\_at, snapshot jsonb | Immutable after submit |
| Protocol | `files` | protocol\_version\_id, kind (MANUSCRIPT, COVER\_LETTER, RECEIPT, GENERATED\_PDF…), storage key, sha256, size | Object storage pointer |
| Forms | `form_definitions` | code, title, version, effective\_date, status, schema jsonb, template\_file\_id, placeholder\_map jsonb | Versioned |
| Forms | `form_instances` | form\_definition\_id, protocol\_version\_id, filled\_by\_member\_id?, data jsonb, status, revision | One per form per version; one per reviewer for F-35/F-36 |
| Forms | `signature_events` | form\_instance\_id, user\_id, signature\_id, data\_hash, ip, ua, signed\_at, voided\_at |  |
| Workflow | `workflow_definitions` | key, submission\_type, name |  |
| Workflow | `workflow_versions` | workflow\_definition\_id, number, status, graph jsonb, published\_at | Steps + transitions + rules |
| Workflow | `workflow_instances` | workflow\_version\_id, protocol\_id, protocol\_version\_id, state, started\_at, ended\_at | Pinned to a version |
| Workflow | `tasks` | workflow\_instance\_id, step\_key, assignee\_user\_id, status, outcome, due\_at, completed\_at | One per assignee |
| Workflow | `holidays` | date, name | For working-day deadlines |
| Meetings | `meetings`, `meeting_outcomes` | date; protocol\_id, decision, notes, recorded\_by | Outcome only in phase 1 |
| Comms | `notifications` | user\_id, type, payload, read\_at, emailed\_at | In-app + email log |
| Comms | `notification_templates` | key, subject, body (Markdown + variables) | Editable |
| Audit | `audit_events` | actor\_id, role, action, entity, entity\_id, protocol\_id, diff jsonb, ip, ua, prev\_hash, hash | Append-only, hash chain |
| Settings | `settings` | key, value jsonb | Protocol code pattern, revision days, panel mapping |

The workflow graph is stored as one `jsonb` document per version (steps, transitions, rules) rather than step rows, so a version is published or rolled back atomically and old instances keep reading their exact graph. Zod schemas validate the graph and form schemas on every save.

**File storage**: an S3-compatible bucket (MinIO on the USC server now; Supabase Storage or S3 later). Files are private; downloads go through signed URLs that expire in 5 minutes and are audited.

## Security and data privacy

The system holds research protocols and personal data, so it follows the Data Privacy Act of 2012 (RA 10173) and replaces the flowcharts' "encrypted protocol" emails with access control and encryption.

- **Access**: a protocol is visible only to its members, assigned reviewers/IC, the panel's chair, REC Chair, REC Staff and admins. Every server action checks this through one `authorize(user, action, resource)` function; no client-side-only checks.
- **Reviewer blinding**: proponents see reviewer comments after release, not reviewer names, unless REC sets otherwise (setting).
- **Encryption**: TLS everywhere, including Vercel → USC database and → Gotenberg (no plain-port exposure); storage bucket and database disks encrypted at rest; backups encrypted.
- **Database exposure**: since Vercel is outside the USC network, the on-prem Postgres needs a path Vercel's serverless functions can use. A Cloudflare TCP tunnel does not work from Vercel, so the options are: PgBouncer with TLS on a USC IP allowlisted to Vercel's static egress IPs (paid Vercel add-on), an HTTP data proxy, or managed Postgres (Supabase) for the database while files and PDF conversion stay on-prem. Decide before M12. MinIO and Gotenberg are HTTP, so they work through Cloudflare Tunnel with Access service tokens. Use a connection pooler (PgBouncer) because serverless functions open many connections.
- **Consent**: F-28 consent is captured as signed data; users can download their data and request deletion through REC Staff (subject to REC retention rules).
- **Retention**: configurable; default keep protocol records 3 years after closure, following the minimum REC suggests to researchers.
- **Rate limiting and lockout** on sign-in, linking and signature confirmation; 2FA optional, required for REC Staff, Chairs and admins.
- **Uploads**: PDF/DOCX/images only, size limit (default 25 MB), virus scan (ClamAV container next to Gotenberg).

## UI and UX

The interface follows the [USC REC-DMS Design System](https://claude.ai/artifact/1GYmQVZAyE8F4kFWY7SXDh), built from the USC seal; the [key screens](https://claude.ai/artifact/FqA2cJPM5t91y458SDxWfD) show it applied. The design system's brand book is the source of truth; this section covers what the app must do.

**Principles**

- Calm and exact, like a well-run university office. Neutral surfaces, USC green as the single action color, the logo's red, blue and gold only as accents.
- Built for phones first for proponents (mostly students), and for long laptop sessions for reviewers and REC Staff.
- REC wording everywhere a form is shown; no paraphrasing of assessment points.
- Nothing that looks machine-made: no gradients, glow, emoji, sparkle icons, greeting banners or filler stat tiles.

**Interaction rules**

- Vertical navigation first: a left sidebar with the seal, role switcher and the active role's items; collapses to an icon rail; becomes a drawer below 1024px. Transitions are smooth (360 ms, soft ease-out), and the active-item marker slides with a spring.
- Motion is slow enough to see: buttons press to 0.97 and spring back; toggles and checkboxes bounce; menus fade and rise; page content fades in. All of it turns into plain fades under reduced-motion settings.
- Loading never uses spinners. First load shows the real layout with blurred placeholders that sharpen when data arrives; refreshes blur the current content slightly; busy buttons keep their label and show a thin progress sweep.
- Themes: Light, Dark and System (default, follows the device), stored per user, rendered on the server with no flash.
- Autosave on every field with visible Saving / Saved / Conflict states; locked shared fields show where to edit them.

**Screen inventory (phase 1)**

| Area | Screens | Main users |
| --- | --- | --- |
| Access | Sign in, Sign up, Verify email, Pending approval notice, Sign-in methods, My signature | Everyone |
| Proponent | Dashboard, My protocols, New protocol wizard, Protocol: Details, Members, Forms, Uploads, Activity; Revision with F-38 | Proponents, Project Leader |
| Adviser | Dashboard, Advised protocols, F-29 verification, F-38 review | Advisers |
| Review | My reviews, F-35 and F-36 assessment, F-38 remarks, F-37 consolidation | Reviewers, IC, Panel Chair |
| Decisions | Determine review type (F-31), Exemption (F-41), Decision and F-39 signing, Meeting outcome | Panel Chair, REC Chair, Member Secretary |
| Secretariat | Screening queue, Fee receipts, Releases, All protocols, User approvals, Reports | REC Staff |
| Admin | Workflows builder, Forms builder, Roles, Settings, Holidays, Notification templates, Audit log | System Admin |
| Shared | Task inbox (all roles), Notifications, Protocol logbook, Verify signature (public) | Everyone |

**Key journeys to test with real users**

1. A student creates a protocol on a phone, invites two co-proponents and an adviser, fills F-27 to F-30, and submits.
2. A reviewer opens an assigned review on a laptop, assesses F-35 and F-36 against the manuscript, signs and submits.
3. REC Staff screens a submission, verifies the fee receipt, returns one incomplete submission, and accepts another.
4. A proponent receives Minor Modifications, revises, fills F-38, gets the adviser's signature, and resubmits within the deadline.

**Brand assets**: the official seal (USC\_StandAloneSeal.png, transparent) is used as provided: sidebar 32 px, sign-in 96 px, never recolored.

## Milestone plan and open decisions

Thirteen milestones, each with its own Cursor prompt file (`prompts/M00…M12`). Each ends with working, tested software; run them in order.

1. **M00 Project setup**: Next.js (App Router, TypeScript), Tailwind + shadcn/ui, Prisma, Docker Compose (Postgres, MinIO, Gotenberg, Mailpit), lint, tests, CI; design tokens, Light/Dark/System themes, motion and blur-loading primitives, and the sidebar app shell from the design system.
2. **M01 Authentication and account linking**: Auth.js with Google, email/password, magic link; link identities; USC vs external approval.
3. **M02 Roles and authorization**: roles, panel and protocol memberships, role switcher, `authorize()`, admin user screens.
4. **M03 Audit trail**: append-only hash-chained events, helper used by all later milestones, timeline and admin search.
5. **M04 Form engine**: definitions, JSON schema, renderer, shared protocol fields, who-fills/when-editable, validation, simple builder with preview.
6. **M05 Protocols and collaboration**: create, invite members, multi-editor autosave with conflict handling, uploads, fee receipt, versions and diff.
7. **M06 Signatures**: signature pad/upload, re-confirm, signature events with data hash, void on edit.
8. **M07 Workflow engine**: graph schema, versions, engine, tasks and inbox, builder UI, validator.
9. **M08 USC REC seed**: all 12 forms as schemas, Initial and Resubmission workflows from the flowcharts, panels, settings.
10. **M09 Notifications and deadlines**: in-app and email, templates, working-day calendar, reminders, escalation cron.
11. **M10 Document generation**: docxtemplater templates, Gotenberg PDF, print view, package bundle, verify page.
12. **M11 Dashboards and reports**: per-role dashboards, overdue view, protocol logbook, CSV exports.
13. **M12 Hardening and deployment**: Vercel, Cloudflare Tunnel to DB and Gotenberg, backups, security review, end-to-end test of a full review cycle.

**Open decisions** (none block M00–M07; settle them before M08)

- [ ] For each step, REC Chair or Panel Chair? Set per step in the workflow builder once REC confirms.
- [ ] Who consolidates F-37 in expedited review (assumed Panel Chair).
- [ ] Should proponents see reviewer names after release?
- [ ] Certificate of Approval template, and forms for continuing review, amendment, final report, SAE (needed for later phases).
- [ ] Original .docx files of all 12 forms (needed for M10).
- [ ] Email sender: Resend or USC SMTP relay; and whether to add Microsoft (USC Office 365) sign-in.
- [ ] USC holiday calendar source for working-day deadlines.
- [ ] Retention period for closed protocols (default 3 years).
- [ ] Database connection path from Vercel to the USC server: allowlisted PgBouncer, HTTP proxy, or Supabase for the database (see Security).
