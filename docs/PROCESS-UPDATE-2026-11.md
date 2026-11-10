# REC process update — November 2026

Sources, copied to `docs/forms/2026-11/`:

- `REC Workflow for Sir Gran.pdf` (stages 01–07, from the REC secretariat)
- `Annex J_USC REC Flowchart ver 7-29Sep2026.pdf` (ver. 07-00, 29 Sep 2026)
- `2025-12-09 - Revised Schedule and Distribution of REC Review Fees Notice_PJL.pdf` (fees effective 1 Jan 2026)
- `billing statement template FINAL (Autosaved).xlsx`
- `REC members.xlsx` (panels, designations, scientist / non-scientist)
- The Word forms for each stage, including two that the system did not have: F-40 Certification of Approval and F-42 Certification of Exemption from Review.

Where this file disagrees with "Decisions recorded 6 Nov 2026" in `docs/SPEC.md`, this file is newer. The items marked **Confirm** are still to be checked with the REC before M14 is run.

## How a change gets into the system

The REC changes its process often. Every change belongs to one of four layers. The goal is that most changes land in layers 1–3, which need no code and no deployment.

| Layer | What changes | Who does it | How | Running protocols |
|---|---|---|---|---|
| 1. Settings and data | Fees, panel members, chair and vice-chair, payment instructions, meeting days, protocol code pattern, deadline numbers in settings, notification wording | REC Staff or System Admin | Admin screens (`/admin/fees`, `/admin/panels`, `/admin/notifications`, settings) | Takes effect at once, or on the effective date |
| 2. Forms | A new field, a new form version, a changed Word template, who may edit a cell | System Admin | Form builder, then publish a new form version; replace the template and placeholder map | Keep the form version they started with |
| 3. Workflow | A new step, a different actor, a new branch, a different deadline, which documents are sent on release | System Admin | `/admin/workflows`: edit a draft, validate, simulate, publish | Keep the workflow version they started with, unless an admin moves them (M13 item 10) |
| — | Any of layers 1–3 with a future effective date (the new forms say 01/01/27) | Same people | Publish now, scheduled; the system switches on the date (M13 item 12) | New protocols use it from that date |
| 4. Engine | A kind of behaviour the engine cannot express yet | Developer | A Cursor prompt like M13, with tests | Code change; deploy |

For each memo or document from the REC:

1. Add a dated entry at the bottom of this file: the source, what changed, and the layer.
2. Layers 1–3: make the change on the admin screens, on staging first. Run the workflow simulation for every review type before publishing.
3. Layer 4: write the smallest engine capability that makes the change a setting, then make the change in layers 1–3. Never put a name, an amount, a number of days, a form list or a signer in code.

Steps the REC does outside the system (paying at the teller, the panel meeting, a phone call) stay manual, but each one is a staff task in the workflow that records the result and the date, with an upload where there is a paper. The protocol then never sits in a state the system does not know about.

## Stage by stage

Legend: **Done** already in the system and matching · **Setting** layers 1–3 · **Engine** needs M13 · **Manual** stays outside, recorded by a staff task.

### 01 Initial submission

| REC says | System now | Type |
|---|---|---|
| Researcher submits F-26, cover letter, F-27, F-28, F-35, F-36, F-30, manuscript with appendices A–F | Researcher fills F-27, F-28, F-29, F-30, F-35, F-36; uploads manuscript, cover letter, fee receipt; staff fills F-26 | Setting (form list on `proponent_submit`) |
| F-29 Capsule Proposal no longer used | F-29 required | Setting (remove from step and F-26 prefill row p4) |
| F-26 submitted by the researcher | Staff completes F-26 with suggestions from uploads (6 Nov decision) | **Confirm**, then Setting |
| No fee at submission; billing comes after the type of review is known | Fee receipt required at submit; fee checked at screening | Engine (billing, M13 item 6) + Setting. Answered 10 Nov: see Fees |
| Code `2026-001-Abregana`, or `2026-001-Abregana et al` for several researchers | `USC-REC-{YYYY}-{####}` | Engine (new code tokens, M13 item 5) + Setting |
| Staff forwards to the Panel Chair; if the Panel Chair has a conflict of interest, the Vice-Chair | Goes to REC Chair | Engine (fallback chain, M13 item 1) |
| Staff within 1–3 working days | 2 calendar days | Setting |

### 02 Type of review

| REC says | System now | Type |
|---|---|---|
| Panel Chair fills F-31 within 1–2 working days | REC Chair, 2 calendar days | Setting (after M13 item 1) |
| Exempt: Panel Chair fills F-31 and F-41 | F-31 by REC Chair, then F-41 by Panel Chair as a second step | Setting (one step, both forms) |
| Exempt: billing statement → researcher pays → F-42 issued | Release exemption with F-39 | Engine (billing) + Setting (F-42 template, release documents) |
| Exempt with recommendations: researcher revises, version stays 1, then F-42 | Not qualified returns and ends | Engine (correction without a new version, M13 item 4) + Setting (new outcome) |
| Full or expedited: Panel Chair assigns 1 scientist (F-35) and 1 non-scientist (F-36) | At least two from Primary Reviewer / Independent Consultant, any mix; each fills F-35 and F-36 | Engine (reviewer slots, M13 item 2). Answered 10 Nov: always one scientist (F-35) and one non-scientist (F-36) |
| Chair's note to reviewers and a due date | Task comment only | Setting (note field on the determine step, shown on the reviewer task) |
| Designation deemed accepted after 72 hours unless the reviewer declines (conflict or other reason); chair re-designates | Reviewer must acknowledge within 48 hours | Engine (timeout outcome and re-designation of one slot, M13 item 3) |

### 03 Review by reviewers

| REC says | System now | Type |
|---|---|---|
| Scientist uses F-35, non-scientist uses F-36 | Each reviewer fills both | Engine (slot forms, M13 item 2) |
| 10 working days | 14 calendar days | Setting |
| No blanks; recommended action and justification required; name, signature, date | Partly validated | Setting (form validation) + Done (signatures) |
| Recommendations needing revision are highlighted yellow | No equivalent | Setting ("Needs revision" tick per point, replaces the highlight; printed as a yellow highlight in Word) + small Engine change to prefill (M13 item 8) |

### 04 Review by Panel Chair

| REC says | System now | Type |
|---|---|---|
| Panel Chair reviews F-37 and may override comments, recommendations, recommended action, justification | REC Chair decides; reviewer words in F-37 are closed | Engine (chair override column, M13 item 14). Answered 10 Nov: the chair does not edit the reviewer's words; the chair's comment overrides them and the reviewer's original stays |
| F-37 signed by REC Staff and Panel Secretary (full review), endorsed and signed by the Panel Chair | Member Secretary endorses (view only, global role) | Engine (per-panel Panel Secretary and Vice-Chair roles, M13 item 1) + Setting (signature steps) |
| Full review: deliberated at the meeting, Panel 1 first Friday, Panel 2 second Friday, Panel 3 third Friday | Second Friday for everyone | Engine (meeting days per panel in settings, M13 item 7) |
| Expedited and disapproved → protocol goes to full review | Ends disapproved | Setting (branch) + small Engine change (`setFields` from a fixed value, M13 item 9) |

### 05 Result sent to the researcher

| REC says | System now | Type |
|---|---|---|
| Not approved: researcher gets F-39 and F-37 | F-39 generated and released | Engine (release package per decision, M13 item 8) |
| Approved: researcher gets F-40 only; F-39 kept by staff; researcher signs F-40 and returns it | Conform button; Certificate of Approval template missing | Setting (F-40 template now supplied; proponent step signs F-40) + Engine (release package) |
| Signed by the Panel Chair; Vice-Chair if the chair has a conflict; REC Chair if both | REC Chair signs | Engine (fallback chain) |
| Release within 3–7 working days | 5 or 3 calendar days | Setting |

### 06 Revised proposal and F-38

| REC says | System now | Type |
|---|---|---|
| Version `2-<date of revision>`, changes highlighted | Version label `2/28May2022` style | Setting (label format) |
| F-38 signed by researchers and adviser | Adviser signs when there is one; researchers fill | Setting (signature fields) |
| Researcher must not see the primary reviewer | Reviewer names hidden from proponents and advisers | Done |
| Resubmission: F-38 and revised proposal only | Also asks for F-35 and F-36 again | Setting (form list on `proponent_revise`) |

### 07 Result of the resubmission

| REC says | System now | Type |
|---|---|---|
| Reviewers fill F-38 remarks, recommended action, justification, name, signature, date; new recommendations highlighted | Each reviewer remarks on their own points | Setting (validation, signatures, "Needs revision" tick) |
| Not approved: F-39 and F-38 **without** reviewer name and signature; next round version 3 with only the open recommendations | F-39 released | Engine (redacted copy of a form and carry-forward of open points, M13 item 8) |
| Approved: F-40 only | As in 05 | As in 05 |
| 3rd to Nth review billed at 50% | No fees | Engine (billing) |
| Major modifications → resubmission goes to full review; minor → expedited (Annex J) | One resubmission route | Setting (branch on the parent decision) |

### Fees (memo of 9 Dec 2025, effective 1 Jan 2026)

The fee depends on the client type and the review type, and the REC changes the amounts every few years. Store them as dated rows, not code: client types (USC SHS/undergraduate, USC Law, USC graduate (free for now), USC faculty with research workload, USC faculty with a grant, external SHS/undergraduate, external medicine/law, external graduate, external institution with grants) × expedited, full, exempt, with 3rd-to-Nth review, amendment and continuing review at 50% of the base. Distribution 70% reviewer honorarium, 20% REC operation, 10% administrative cost is a report setting. The statement of account follows the billing template: date, names, department, description `Ethics review fee for Protocol <code>: <title> (<review type or "3rd Review">)`, amount, payment instructions, "Certified correct" by REC Staff.

### Panels and members

`REC members.xlsx` lists three panels with Panel Chair, Vice-Chair, Secretary, scientists and non-scientists, an alternate member, and affiliate / non-affiliate. Membership changes often, so it is imported from the spreadsheet on `/admin/panels` (M13 item 11), not typed into the seed.

### Later phases (Annex J, not in M14)

Post-approval (F-45, F-46, F-48 to F-51, F-53, F-55), archiving (inactive 30 working days after a request, or no communication for a year after clearance), file disposal after five years. Retention already exists; the rest is new workflows built in the builder once the forms are supplied.

## Answered by the REC (10 Nov 2026)

- **Billing:** expedited and full reviews are billed as soon as the Panel Chair classifies the review. The review does not wait for payment. Staff check receipts any time from the start of review until the decision is released. Release normally waits for payment, but REC Staff may release a decision that is not fully paid, at their discretion.
- **Reviewers:** always one scientist, who fills F-35, and one non-scientist, who fills F-36.
- **F-37:** the Panel Chair does not edit the reviewers' words. The chair adds an overriding comment; the reviewer's original comment is kept.
- **Start date:** the new process takes effect on 1 Jan 2027. Until then new protocols keep the current process.

## Still to confirm with the REC

1. F-26: does the researcher fill it, or does staff still complete it from the uploads?
2. Can an Independent Consultant fill the scientist or non-scientist slot? Can the chair add a third reviewer?
3. F-37 copies sent to the researcher: only the chair's comment where the chair overrode, or both? (Default: only the chair's comment; staff see both.)
4. "3rd review": is it the third review round of the same protocol (version 3)?
5. Is the 72-hour acceptance counted in calendar hours or working days?
6. Approved: the F-40 Word file has a Conformé line for the researcher(s). Does the adviser sign too?
7. Expedited disapproved → full review: does it keep the same reviewers?
8. Existing protocol codes (`USC-REC-2026-0001`): keep them, or reissue in the new format?
9. Resubmission decision: Panel Chair, with the same conflict-of-interest fallback?

## Change log

- 2026-11-10: this file, from the documents above.
- 2026-11-10: fix tasks 5–10 run before M13. Task 7 (F-29 email) is affected because F-29 is no longer used; task 9 (F-36 "If NO") should match the new F-36 10-00 wording (page and line, Unable to assess / Yes / No); task 8 ("Needs action" flag) is the flag M13 item 8 reuses.
- 2026-11-10: REC answered billing timing, reviewer slots, F-37 override and the 1 Jan 2027 start (see "Answered by the REC").
