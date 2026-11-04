# M09 — Notifications, reminders and escalation

Read first: `docs/SPEC.md` → "Signatures, audit trail and notifications" (Notifications), "Configurable workflow engine" (Deadline).

## Goal
The right people hear about tasks, deadlines and decisions, in the app and by email, and overdue work escalates automatically.

## Data model
- `Notification`: id, userId, type, title, body, link, protocolId, taskId, readAt, emailStatus `NONE | QUEUED | SENT | FAILED | DIGEST`, createdAt.
- `NotificationTemplate`: key (unique), subject, bodyMarkdown, channels (`IN_APP`, `EMAIL`), description, variables (documented list).
- `NotificationPreference`: userId, digest `IMMEDIATE | DAILY` (task assignments and decisions always immediate).

## Tasks
1. Job runner: `src/server/jobs/runner.ts` processes due `Job` rows (from M07) with `FOR UPDATE SKIP LOCKED`, retries with backoff (max 5), records `lastError`.
   - Route `/api/cron/jobs` (protected by `CRON_SECRET`), called every minute in dev (script) and by Vercel Cron in prod (`vercel.json`; Vercel Hobby allows only daily cron — note in DEPLOY.md that Pro is needed for hourly/minutely, or call the route from a cron on the USC server).
2. Email: `src/server/mail.ts` interface with Nodemailer SMTP implementation (USC relay or Mailpit) and a Resend implementation; choose by env. HTML via React Email, plain-text fallback. Sender name "USC Research Ethics Committee".
3. Templates seed (editable in `/admin/notifications`, Markdown with `{{variables}}`, preview with sample data): `task.assigned`, `task.due_soon`, `task.overdue`, `task.escalated`, `task.reassigned`, `protocol.returned_incomplete`, `protocol.decision_released`, `protocol.revision_due_soon`, `protocol.lapsed`, `invite.member`, `account.approved`, `signature.voided`, `fee.rejected`.
4. Engine hooks: on step enter / task assign / complete / release, enqueue per the step's `notify` config + cc rules.
5. SLA scan `/api/cron/sla` (hourly): for OPEN/CLAIMED tasks, send `due_soon` per `remindBefore` (once each), `overdue` at `dueAt` (once), and escalate to `deadline.escalateTo` after overdue (once; audit `task.escalated`). Also the WAIT_PROPONENT revision deadline: remind at 5 and 1 working days before, lapse at due.
6. Daily digest job at 07:00 Asia/Manila for users with DAILY preference.
7. Nightly `audit.verifyChain` job from M03; on failure notify SYSTEM_ADMIN.
8. In-app: bell with unread count in the top bar, dropdown of latest 10, `/app/notifications` page, mark read / all read. Poll every 30 s (swappable for SSE later).
9. Profile → notification preferences.

## Acceptance criteria
- Assigning two reviewers sends each an in-app notification and an email (visible in Mailpit) with a link to the task.
- With the clock mocked: due-soon at the configured offset, overdue at due time, escalation to the configured role; each fires exactly once even if the cron runs repeatedly.
- A failing SMTP send is retried and marked FAILED after 5 attempts without blocking other jobs.
- Tests cover the SLA scanner with working-day deadlines across a weekend and a holiday.
