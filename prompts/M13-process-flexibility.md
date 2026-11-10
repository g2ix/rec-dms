# M13 — Engine capabilities for the November 2026 process

Read first: `docs/PROCESS-UPDATE-2026-11.md` (all of it), `docs/SPEC.md` → "Configurable workflow engine", `docs/CHANGELOG.md` (M07–M12 and later entries), `src/lib/workflow/graph.ts`, `src/server/workflow/engine.ts`, `src/server/workflow/who.ts`, `src/server/protocols/fees.ts`.

## Goal
Add only the engine capabilities the November 2026 REC process needs, each one generic and configured from the database, so the next process change is a setting or a published workflow version, not code. This milestone does **not** change the USC REC seed; M14 does that.

Rules for every item:
- No REC names, amounts, day counts, form codes or signers in code. They come from the graph, form definitions or settings.
- Every new graph field is optional, validated in `graph.ts`, editable in the workflow builder, shown in the simulation, and covered by `validate.ts`.
- Published workflow versions already in use keep working unchanged. Add a test that loads the current seeded graphs and runs the existing cycle test with no change.
- Each state change writes its audit event in the same transaction.

## Tasks

1. **Per-panel roles and a conflict-of-interest fallback.**
   - Seed roles `PANEL_VICE_CHAIR` and `PANEL_SECRETARY` with scope PANEL. One holder each per panel, like Panel Chair.
   - New assignee rule `FIRST_AVAILABLE` with an ordered list of rules, e.g. Panel Chair → Panel Vice-Chair → REC Chair. A person is skipped when they are a member of the protocol or have declared a conflict of interest on it.
   - `ConflictDeclaration` (protocolId, userId, reason, declaredAt, stepKey). A side task "Declare a conflict of interest" on any step whose assignee rule is `FIRST_AVAILABLE` or a reviewer slot. Declaring it reassigns the open task to the next person in the chain and notifies REC Staff.
   - Generated documents print the person who actually completed the step (already true for the deciding chair; check F-39 and the new certificates).

2. **Reviewer slots.**
   - `assignReviewers.slots`: `[{ key, label, eligible: { roles?, attributes? }, forms: [codes] }]`, used instead of `roles/min/max` when present. Example: `SCIENTIST` fills F-35, `NON_SCIENTIST` fills F-36.
   - Member attributes on panel role grants: `designation`, `isScientist`, `discipline`, `affiliate`, `alternate`. The picker shows eligible members of the protocol's panel first, then alternates, then others with the eligible role.
   - Step forms can be limited to a slot: `forms[].slot`. A reviewer sees and fills only the forms of their slot. `perAssignee` still works for graphs without slots.
   - Assignments keep the slot: `assignments[stepKey] = [{ userId, slot }]`, with a reader that still accepts the old `string[]`.

3. **Deemed acceptance and re-designation.**
   - Step field `onTimeout: { outcome }`. When the deadline passes on an open task, the SLA scan completes it with that outcome as the system actor, audited as `task.timed_out`. Use it for "Accept the designation" with outcome `ACCEPT` after 72 hours.
   - The reviewer can choose `DECLINE` with a required reason before then. That opens a re-designation task for the step's chair, which replaces only that reviewer's slot, then opens the acceptance task for the new reviewer only. The other reviewer's acceptance and work continue.
   - The determine step can capture a `noteToReviewers` (text) and `reviewDueDate`. Both show on the reviewer's tasks and in the `task.assigned` email.

4. **Correction without a new version.**
   - Action `REOPEN_VERSION`: the frozen version's uploads and the named forms become editable by the proponents again, keeping the same version number. Re-submitting re-freezes it. The audit diff records what changed. Use it for "Exempt with recommendations, version stays 1".

5. **Protocol code tokens.**
   - Pattern tokens: `{YYYY}`, `{###}` (zero padding from the number of `#`), `{LEADER_FAMILY}`, `{ET_AL}` (" et al" when the protocol has more than one researcher, otherwise empty). Sequence is per year and unique. Example `{YYYY}-{###}-{LEADER_FAMILY}{ET_AL}` → `2026-001-Abregana et al`.
   - Codes already issued never change. A pattern change applies to the next code.

6. **Fee schedule and billing.**
   - Tables: `ClientType` (key, label, active), `FeeSchedule` (effectiveFrom, approvedRef, notes), `FeeRate` (scheduleId, clientTypeKey, basis `EXPEDITED | FULL | EXEMPT`, amount), `FeeRule` (scheduleId, key such as `NTH_REVIEW`, `AMENDMENT`, `CONTINUING`, percent of base, fromRound), `Bill` (protocolId, versionId, description, amount, scheduleId, status `ISSUED | PAID_PENDING | PARTIALLY_PAID | VERIFIED | REJECTED | WAIVED`, amountPaid, issuedBy, issuedAt).
   - Protocol field `clientTypeKey`, suggested from the project leader's affiliation profile and level, set by REC Staff.
   - Action `ISSUE_BILL` with params `{ basis: "reviewType" | "nthReview" | ... }`. It picks the schedule in effect on the issue date, computes the amount, creates the `Bill`, and generates the statement of account from a template whose description pattern and payment instructions are settings. A zero amount is recorded as `WAIVED` and needs no payment.
   - The proponent uploads proof of payment against the bill, at any time while the bill is open. REC Staff verify or reject it, or record a partial payment amount, reusing the existing fee-receipt screen and notices. Issuing a bill never blocks the review steps.
   - `feeVerifiedOutcomes` checks the bill of the current round. New step option `feeOverride: true`: REC Staff may still choose the outcome when the bill is not verified or only partly paid, after typing a reason. Audited as `fee.release_override` with the amount outstanding; the bill stays open and shows on the Fee receipts list until settled.
   - `/admin/fees` (REC Staff, System Admin): schedules with effective dates, a grid of client type × basis, the rules, and a preview calculator. A new schedule never changes bills already issued.
   - Reports: bills issued and paid by period, panel and client type, with the distribution percentages from a setting (`fees.distribution`).

7. **Meeting days per panel.**
   - Setting `meetings.schedule`: per panel, the weekday and the week of the month (Panel 1 → 1st Friday, ...) and the submission cutoff in days. `reports/meetings.ts`, the full-review cutoff warning and the meeting-date capture default read it. Remove the fixed second Friday.

8. **Release packages, redacted copies and open points.**
   - Step field `release: { [decision]: { send: [form codes or "certificate:<key>"], keep: [...] } }`. Only `send` items are visible and downloadable to proponents and advisers; `keep` items are generated and filed for staff.
   - Form render option `redact: [field paths]` per release item, e.g. F-38 sent without reviewer name and signature. The stored form is not changed; only the generated copy.
   - Reuse the "Needs action" flag built in task 8 of the earlier fix list (see `docs/CHANGELOG.md`); do not add a second flag. Only add what is missing: the flag printed as a yellow highlight in the Word output, and the next round's F-38 carrying forward only points still flagged after the reviewers' remarks.

9. **Small graph additions.**
   - `setFields` with `from: "value"` and a `value`, e.g. set `protocol.reviewType` to `FULL` when an expedited review ends disapproved.
   - Conditions can read `parent.decision` and `protocol.round` (review round number, 1 for the initial review).
   - Version label format is a setting (`protocol.versionLabel`, e.g. `{N}-{DDMMMYYYY}`).

10. **Moving running protocols to a new workflow version.** Admin-only on the protocol page: choose a published version and the step to resume at; the tool shows the mapping, keeps completed history, closes open tasks with a note, and opens the target step. Audited as `workflow.migrated`. Off by default for each protocol; never automatic.

11. **Panel members import.** `/admin/panels` → Import from a spreadsheet in the layout of `docs/forms/2026-11/REC members.xlsx` (Panel, No., Name, Designation, Discipline, Affiliation, Email, extra email). Show a preview of what changes: new people (invited when they have no account), designation changes, people removed (their grants are revoked with the reason "Panel list import"). Open tasks are not moved. Nothing is applied until staff confirm.

14. **Chair override on a summary.** A form table column can be marked `overrides` another column (e.g. `chair_comment` overrides `comments`, `chair_recommendation` overrides `recommendations`). The chair fills the override; the reviewer's original is never changed. Staff and chairs see both. Copies for proponents and advisers show the override where one exists and the original otherwise, as a setting per release item (`showOriginal: false`). Prefill and the next round's F-38 use the overriding text.

12. **Effective dates.** Form versions, workflow versions and settings rows can be published with a future `effectiveFrom`. Until that date the current version stays in use for new protocols; on the date a job switches new protocols to it (audited as `form.version_effective` / `workflow.version_effective`). Admin screens show "Scheduled for 1 Jan 2027" and allow cancelling before the date. The new official forms say "Effective Date: 01/01/27" while some (F-27, F-28, F-30, F-39, F-41) stay at 08/01/25, so each form has its own date.
13. **Certificate dates.** Template fields computed from the release date with settings: approval period (1 year), progress report due (6 months), continuing review due (30 days before expiry). Used by F-40 and F-42.

## Acceptance criteria
- A form version scheduled for a mocked future date is not used by new protocols before that date and is used on and after it; a protocol started earlier keeps its version.
- The existing seeded workflows and `zz-usc-rec.cycle.test.ts` pass unchanged.
- A test graph with `FIRST_AVAILABLE` (chair → vice-chair → REC Chair): the chair declares a conflict, the task moves to the vice-chair; when both declare, the REC Chair gets it; a generated letter names the person who signed.
- A test graph with two reviewer slots: each reviewer sees only their slot's form; one declines, the chair re-designates that slot only; the other reviewer's acceptance times out to `ACCEPT` after the mocked 72 hours.
- `REOPEN_VERSION` lets the proponent change a file, keeps version 1, and re-freezes on submit.
- Code pattern `{YYYY}-{###}-{LEADER_FAMILY}{ET_AL}` gives `2026-001-Cruz` and `2026-002-Santos et al`.
- With the 1 Jan 2026 schedule: USC undergraduate exempt → 800; USC undergraduate full, round 3 → 1,000; USC graduate → waived. A new schedule effective later does not change those bills.
- Changing Panel 3's meeting to the 3rd Friday changes the meetings report without a deploy.
- A bill issued at classification does not block the reviewers; a release with the bill unpaid is refused for the Panel Chair and allowed for REC Staff only with a reason, and the override shows in the audit log.
- The chair overrides one F-37 comment: the reviewer's text is unchanged in the database, the staff view shows both, the proponent's PDF shows only the chair's.
- A redacted F-38 PDF has no reviewer name or signature; the stored form still has them.
- Importing `REC members.xlsx` into an empty database creates three panels with chair, vice-chair and secretary grants and the scientist flags; importing it again changes nothing.
- `pnpm lint && pnpm typecheck && pnpm test` pass; the builder can edit every new field.

## Manual check
1. In the builder, make a copy of the initial workflow, set the type-of-review step to `FIRST_AVAILABLE`, add two slots, simulate an expedited review end to end.
2. On `/admin/fees`, add a schedule effective next month and check the calculator for both dates.
3. Import the members spreadsheet, change one designation in the file, import again, and read the preview.

Write a CHANGELOG entry "M13 — Process flexibility" with the usual "Deviation from the request" section.
