# M08 — USC REC seed: forms, workflows, panels, settings

Read first: `docs/SPEC.md` → "Current USC REC process" (all), "Configurable workflow engine" (Seed workflow), "Milestone plan and open decisions". Source documents in `docs/forms/` (Updated_USC_REC_Forms.pdf, the Guide to USC REC Forms, F-35/F-36 guides, General Flow Chart of REC Procedures).

Before coding, list any field or step you are unsure about and ask. Use the REC wording exactly for labels and assessment points; do not paraphrase.

UI: the reviewer assessment view must match the "Reviewer: F-35 assessment" screen in the REC-DMS key screens canvas; on phones, assessment tables render as stacked cards like the "Phone" screen.

## Goal
The system runs the real USC REC Initial Submission and Resubmission processes, with all 12 phase-1 forms, entirely from seed data that admins can edit afterwards.

## Tasks
1. Seed files under `prisma/seed/usc-rec/`, one per form, as JSON schemas (M04 format), version `09-00`, effective date 2025-08-01:
   - **F-26 Document Receipt Form**: submission type (radio, from the form's list), mandatory documents checklist items 1–15 as an assessmentTable with Yes/No/NA filled by REC_STAFF; system pre-fills suggestions from uploads/fee status; remarks; received by + date (staff signature).
   - **F-27 Research Protocol Application Form**: application details (bound shared fields), research type (checkboxes incl. "Others: specify"), duration, participants, study site, source of funds (checkboxes with amounts/names), the 6 declarations (declaration fields, all required), conflict of interest (radio + requiredIf details), signatures of all proponents (repeating signature bound to proponent roster).
   - **F-28 Data Privacy Consent Form**: staticText of the policy (from the PDF), two consent declarations, names + signatures + dates of all proponents.
   - **F-29 Capsule Proposal**: Introduction items 1–5, Operational Definitions, Methodology items 1–13, Data Analysis Plan, Ethical Considerations — each a textarea with the form's instruction as help and `naAllowedWithReason`; researcher table (name, designation/course & year & institution, email, signature, CV appendix no.); adviser verification block (signature, name, designation, unit, institution, email, appendix no.) filled by ADVISER.
   - **F-30 Detailed Budget Sheet**: repeatingTable lines grouped by PS / MOOE (with Ethics Review Fee) / Capital Outlay / Administrative Cost, columns Personal / External / Internal / Total (computed), sub-totals and grand total computed; external source name.
   - **F-31 Form on Determining the Type of Review**: submission type, risk level (no risk, below minimal, minimal, greater than minimal), exempt yes/no, review type (Expedited/Full) requiredIf not exempt, justification, designated reviewers (a list the chair can add to; do not require one scientist and one non-scientist), accomplished by signature. Filler: the role set on the workflow step. Do not auto-route "no risk" or "below minimal" to exemption.
   - **F-35 Protocol Review Assessment Form**: assessmentTable with all points 1.01–3.10 + "other concerns" exactly as in the PDF; columns: page & paragraph (PROPONENT, editable only in the proponent start step), assessment Yes/No/Unable to assess, detailed comments, specific recommendations (PRIMARY_REVIEWER/IC); recommended action radio (Approved / Minor / Major / Disapproved) + justification + reviewer signature. `perAssignee: true` in the workflow.
   - **F-36 ICF Assessment Checklist**: same pattern, points 1.1–1.18 + questions 2–4, from the PDF.
   - **F-37 Summary of Reviewers' Comments**: header (type of review, reviewed by the deciding chair, date), PRAF section and ICF section. On step enter, the system copies reviewer comments and suggestions from every F-35 and F-36 and shows only points that have them. Those copied comments are read-only. The chair fills only the recommended action and the justification.
   - **F-38 Summary of Actions Taken**: same points; columns panel comments (pre-filled from F-37, read-only), actions taken + page/paragraph (PROPONENT), remarks. Each reviewer remarks only on points they commented on in F-35 or F-36. Adviser signature is required only when the protocol has an adviser. Recommended action and justification are the chair's. Outcomes remain Approved / Minor / Major / Disapproved.
   - **F-39 Notification of REC Decision**: date of review, type of review, type of submission, documents under review with version numbers (pre-filled), decision, conditional instructions text per decision (from the PDF; the 30 working days start at staff release, not at the chair's decision), justification copied from F-37 if disapproved. The decision step is signed by whoever the workflow assigns (REC Chair in the seed). Keep the printed label "USC Panel Chair" until the Word template changes. The participant contact name inside F-37 point 1.15 is the REC Chair.
   - **F-41 Checklist for Exemption from Ethical Review**: criteria 1.1.x from the PDF (YES/NO + comments), recommended action Qualified / Not Qualified, summary of recommendations, justification, Panel Chair signature.
2. Workflow seed `INITIAL_SUBMISSION` v1 following the SPEC seed workflow and the flowchart deadlines:
   - `proponent_submit` (TASK, PROTOCOL_LEADER; forms F-27, F-28, F-29, F-30, F-35 [page/para only], F-36 [page/para only]; uploads MANUSCRIPT, COVER_LETTER, FEE_RECEIPT)
   - `staff_screening` (TASK, ROLE REC_STAFF, 2 calendar days; form F-26; outcomes ACCEPT / RETURN_INCOMPLETE → back to `proponent_submit`; fee verification required for ACCEPT)
   - `assign_code` (AUTO ASSIGN_PROTOCOL_CODE + SNAPSHOT_VERSION)
   - `determine_review` (DECISION, ROLE REC_CHAIR, 2 days; form F-31; outcomes EXEMPT / EXPEDITED / FULL; setFields reviewType; assignReviewers for EXPEDITED/FULL roles PRIMARY_REVIEWER and INDEPENDENT_CONSULTANT in any mix, min 2, max left open so the chair can add more than two)
   - Exempt branch: `exemption_check` (PANEL_ROLE_OF_PROTOCOL PANEL_CHAIR, 2 d, F-41, outcomes QUALIFIED / NOT_QUALIFIED). QUALIFIED → `staff_release_exempt` (REC_STAFF, 5 d) → `end_exempted`. NOT_QUALIFIED → return to the project leader and notify REC_STAFF.
   - Expedited: `reviewer_ack` (PARALLEL_TASK ASSIGNED_IN_STEP determine_review, 48 h), `reviewer_assess` (PARALLEL_TASK, 14 d, F-35 + F-36 perAssignee FILL+SIGN; cc REC_STAFF on completion), `chair_decide` (DECISION ROLE REC_CHAIR, 3 d, F-37 recommendation and justification only; outcomes APPROVED / MINOR / MAJOR / DISAPPROVED; the chair's outcome wins over the reviewers), `chair_sign_decision` (SIGNATURE, same chair, F-39), `staff_release` (REC_STAFF, 5 d).
   - Full: `reviewer_ack`, `reviewer_assess`, `meeting_outcome` (TASK REC_STAFF, records meeting date + consensus; do not add routing for a missed 14-day cutoff), `member_secretary_endorse` (ROLE MEMBER_SECRETARY, 3 d, endorsement only, no edit of F-37), `chair_finalize` (DECISION ROLE REC_CHAIR, 3 d; the outcome may be the meeting consensus or the chair's override), `chair_sign_decision`, `staff_release` (3 d).
   - Decision routing after release: APPROVED → `proponent_conform` (PROTOCOL_LEADER action; signature only if the step lists one) → `end_approved`; MINOR/MAJOR → `await_revision` (WAIT_PROPONENT 30 WORKING_DAYS from `staff_release`; on overdue → `end_lapsed`, and a later application reuses the protocol code; proponent action START_WORKFLOW `RESUBMISSION`) ; DISAPPROVED → `end_disapproved`. Do not add an appeal path.
   - Protocol status labels per step as in SPEC "Statuses".
3. Workflow seed `RESUBMISSION` v1: `proponent_revise` (leader; new protocol version; upload revised MANUSCRIPT; F-38 actions taken; F-35/F-36 page/para), `adviser_review` (PROTOCOL_ADVISER signs F-38; skip this step when the protocol has no adviser), `staff_screening` (2 d), `reviewer_assess` (same reviewers by default; each remarks only on points they raised; 14 d), `chair_decide` (DECISION ROLE REC_CHAIR), `chair_sign_decision`, `staff_release`, then the same decision routing (another revision starts another RESUBMISSION instance chained by `parentInstanceId`). Treat "same reviewers, no new meeting" as the editable default, not as a confirmed REC rule.
4. Do not build extension requests in this milestone. How long an extension lasts, how often it can be asked, and whether the clock pauses are still open.
5. Settings seed: protocol code pattern `USC-REC-{YYYY}-{####}` (sequence per year, editable), revision days 30 working days, auto-approve domains, max upload size, panel ↔ discipline mapping, REC contact info for templates.
6. Disciplines seed per panel from the Guide (Panel 1 Management, Education, Political Science, Law, Economics, Accountancy; Panel 2 Engineering, Architecture, Fine Arts, Psychology, SoAn, other social sciences; Panel 3 Natural Sciences, Health Sciences).
7. Demo seed (only when `SEED_DEMO=true`): one user per role, two sample protocols (one expedited, one full) for E2E tests.
8. Playwright E2E: full expedited cycle with Minor Modifications → resubmission → Approved, using the demo users.

## Acceptance criteria
- A fresh database + `pnpm db:seed` runs both workflows end to end in the E2E test.
- Every assessment point text matches the PDF (add a test that compares point codes 1.01–3.10 and 1.1–1.18 counts).
- Changing `determine_review` assignee from REC Chair to Panel Chair in the builder and publishing v2 works without code changes.
- F-37 shows only assessment points that have a reviewer comment or suggestion, and the chair cannot edit those copied comments.
- Field `page & paragraph` in F-35 is editable by proponents only at `proponent_submit` / `proponent_revise`.

## Ask before
- Anything still listed under "Still open" in `docs/SPEC.md`. Do not fill those gaps with a guess. The 6 Nov 2026 decisions override the older "default to Panel Chair" note.
