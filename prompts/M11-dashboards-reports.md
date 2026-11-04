# M11 — Dashboards and reports

Read first: `docs/SPEC.md` → "Users, roles and accounts" (Role switching), "Current USC REC process" (Review tracks, time limits), "Signatures, audit trail and notifications" (Audit trail views).

UI: match the "Proponent dashboard" and "Loading" screens in the REC-DMS key screens canvas; every count on a dashboard links to the list it counts (no filler stat tiles).

## Goal
Each role view opens on a dashboard that shows what needs attention; REC Staff and Chairs can see the whole pipeline and export it.

## Tasks
1. Dashboards per active view (server components, queries in `src/server/reports/*`):
   - **Proponent**: my protocols with status, current step, who has it, due date; actions waiting for me (sign, fill, revise); revision deadline countdown.
   - **Adviser**: protocols I advise; signatures and F-38 reviews waiting.
   - **Reviewer / IC**: assigned reviews with due dates; completed reviews.
   - **Panel Chair**: protocols in my panel by step; decisions waiting; reviewer load per reviewer; overdue in my panel.
   - **REC Staff**: screening queue in arrival order (REC reviews in the order received), fee receipts to verify, decisions to release, pending user approvals, all overdue tasks.
   - **REC Chair / Admin**: pipeline counts per step and review type; overall overdue; turnaround vs the limits (expedited 28 days, full 7 weeks, from complete documents = completion of `staff_screening`).
2. Protocol logbook page (replaces the flowchart's "Logbook of Communications"): per protocol, all workflow events, releases, notifications sent, documents generated, from `AuditEvent` + `Notification`.
3. Reports `/app/reports` (REC Staff, Chairs, Admin): filter by date range, panel, review type, status, submission type; table + CSV export; metrics: submissions received, decisions by outcome, median and 90th percentile turnaround per review type, share within the time limit.
4. Meeting outcomes list: protocols awaiting `meeting_outcome` grouped by the next 2nd-Friday date (computed), with the 14-day cutoff flag for full review.
5. Global search (Staff, Chairs): by protocol code, title words, proponent name.

## Acceptance criteria
- Switching role view changes the dashboard immediately; counts match the task inbox.
- Turnaround metrics computed from demo data match a hand-calculated test fixture.
- CSV exports respect authorization (a Panel Chair only exports their panel).
- Dashboards load under 1 s with 5,000 protocols of seeded data (add indexes as needed; include the seed script for load testing).
