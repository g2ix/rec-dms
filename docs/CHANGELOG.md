# Changelog

## INTAKE-01 — One intake per version; forms generated from it (2026-11-12)

The proponents answer one **intake** per protocol version, on the new **Intake** tab. F-26, F-27, F-28, F-30 and the proponent columns of F-35, F-36 and F-38 are generated from it and from **Details**, which is now labelled as the intake's Study section. Proponents no longer fill those forms one by one. Their form copies keep only what reviewers, staff and the chair enter, plus the researchers' signatures.

**Intake model.** `protocol_intakes` holds one row per `protocol_versions` row, with:
- `scoping`: consent needed and waiver reason, minors, vulnerable, focus groups, online consent, non-English ICF, faculty-initiated, personal data;
- `coi`: none, or specify with text;
- `budget_lines`: section PS / MOOE / CAPITAL / ADMIN, item, personal / external / internal in centavos, and one Ethics Review Fee line;
- `references`: point code → `{ page, line }` or `"NA"`;
- `actions`: F-38 actions taken, per open point.

`intake_agreements` records each researcher's agreement to the F-27 declarations and the F-28 consents, with its time. It points at the signature in `signature_events` and stores no copy of it. A trigger freezes the intake and its agreements with a submitted version; only linking a signature is still allowed. Study fields stay on the protocol and are not duplicated.

**Saving.** `saveIntakeAction` (and `POST /api/protocols/[id]/intake` for sendBeacon) saves one section at a time:
- It uses the forms' autosave queue: debounce, `flushAll` before actions, keepalive on hide.
- It handles conflicts per section ("changed by … a moment ago", with Use theirs / Keep mine).
- Each save is audited as `intake.section_saved`.

Only proponents on the protocol can write. `protocol.edit` is checked first, then the service admits proponents only, so advisers cannot write. Each researcher agrees or withdraws for their own account (`intake.agreed`, `intake.agreement_withdrawn`). Withdrawing voids that researcher's linked signature. Only the leader can submit, as before. The proponents' submit step on an intake version needs the intake complete: Details study fields, every scoping answer, COI, at least one budget line, a reference or NA for every applicable point, every researcher's agreements, and on a resubmission an action for every open F-38 point. The submission checklist lists the same items under Intake.

**Forms as outputs (version 11-01).**
- Form definitions accept `source: "intake"`. On such a form every proponent field is a `bind` to `protocol.*`, `intake.*`, `team.*` or `system.*`, and is read-only. An assessment column can bind `intake.references` or `intake.actions`. The schema validator refuses an unbound proponent field on an intake form.
- Fields gain `visibleToRoles`, as columns already had. On F-35 and F-36, proponents see the point and their Page & Line No. only: no reviewer columns, no recommended action, no reviewer names. F-38 hides the reviewer block from them the same way.
- The renderer, step validation, signature hashes, the verify page and printing all read the stored copy with the bound values laid over it (`overlayBound`, `effectiveFormData`).
- A Details or intake change that alters what an intake form prints gives that copy a new revision, so a stored print is not reused. It also voids the signatures on it.
- Before signing F-27 or F-28, a researcher must have agreed on the intake. The signature is then linked to that agreement.

The 11-01 versions:
- **F-26:** header bound. The workflow suggests rows 1–4 and 11 as Yes or No; F-27 and F-28 count as Yes only when every researcher signed. Row 14 is Yes or NA from supporting uploads. Staff confirm every row and fill the rest. Remarks, received by and date stay staff fields.
- **F-27:** header, research type, duration, participants, site and funds come from Details. The six declarations and the COI block use the exact wording of the Word file. `fund_amounts` is gone. There is one signature row per researcher, each with its own date.
- **F-28:** the official privacy statement and the two consents. One row per researcher from the team, with signature and date.
- **F-30:** the Personal / External / Internal / Total columns come from `budget_lines`, and the totals are computed. A column opens only for a matching source of funds: researcher-funded opens Personal only. The Ethics Review Fee line starts from the expedited rate for the protocol's client type in the fee schedule. The proponent can change the amount and choose its column.
- **F-35:** the November points. The proponent column is "Page & Line No. (p. __, line __)", bound to `intake.references`. Point 4 takes no reference.
- **F-36:** every point of the November Word file in order: the gateway, A.01–A.26, B.01–B.02, C.01–C.04, D. The proponent column is bound to `intake.references`. The gateway rows and D take no reference: on the Word file they are the reviewer's.
- **F-38:** only the flagged F-35 and F-36 rows. Actions Taken (page and paragraph) is the only proponent column, bound to `intake.actions`. The type of review prints from the protocol. Every researcher signs, then the adviser.
- **F-29:** retired. A new `form_definitions.retired_from` keeps it from protocols created on or after the start. Protocols created earlier keep it, and old copies stay readable.

The M14 versions of these seven codes (F-26 10-00; F-27, F-28 and F-30 09-02; F-35, F-36 and F-38 10-02) are retired where unused. F-31, F-37 and F-39 to F-42 keep their M14 versions.

**Scoping rules as data.** The `intake.scopingRules` setting is seeded from `prisma/seed/usc-rec/scoping-11.ts`. Each rule is a JSONLogic condition on `{ scoping }`, the points it covers, and a reason. A rule holds only on a "no", never on an unanswered question. Points it covers are left out of the proponent's reference list, print `NA`, and show reviewers "N/A (proponent: …)". Reviewers can still comment there, and nothing is required on those points. The seeded rules:
- `minors=false` → F-36 A.07;
- `focusGroups=false` → A.17;
- `onlineConsent=false` → A.25;
- `nonEnglishIcf=false` → B.02;
- `facultyInitiated=false` → F-35 2.02;
- `personalData=false` → F-35 3.02–3.10;
- `consentNeeded=false` → all of F-36 after the gateway, with the proponent's waiver reason as the reason.

**Start date.** On 12 Nov 2026 the REC asked for the November process to apply at once: the system is demonstrated now and used for real next year. `PROCESS_START` is therefore 12 Nov 2026 (Asia/Manila) for the whole November process: the M14 workflows, the scheduled settings and the forms. Protocols created before that keep the 2025 process (09-01, 10-01) to the end. The seed moves or retires rows M14 had scheduled for 1 Jan 2027 that nothing uses yet:
- form versions move to the new start;
- workflow versions are archived;
- unapplied setting schedules are cancelled.

**Version label.** Forms print `2/01Jan2027`, as the F-38 Word file shows. The `protocol.versionLabel` schedule is now `{N}/{DDMMMYYYY}`. The suggested manuscript file name uses the dash the REC workflow note asks for (`Manuscript_2-01Jan2027.pdf`).

**Backfill.** `pnpm db:backfill-intake` (also run by `pnpm db:seed`) copies the F-27 answers of existing protocols where the protocol field is empty:
- duration and participants from a leading number;
- site;
- research type codes;
- sources of funds with their names.

The COI goes into the intake of the latest version unless that version is frozen. Each protocol touched is logged on the console and as an `intake.backfilled` audit event, which lists what was copied and what could not be read (for example "about thirty learners", or `fund_amounts`). Form copies are not changed. A second run copies and logs nothing new.

Also:
- The client-type rules read the source of funds from Details when the application form no longer holds it.
- `layoutBudget` takes a strict mode for intake forms.
- The `signers` print helper prints one row per researcher.
- The new templates are in `templates/11-01/` (see `docs/TEMPLATES.md`).
- Bound values nobody types (protocol code, version label, submission date, review type) say when they are set instead of linking to Details (`SET_BY_SYSTEM`).
- Sessions survive a busy database. When the per-request status check in the `jwt` callback fails on an existing session, the last known status is kept. Before, Auth.js cleared the session, which signed people out; while a page rendered, it failed the page with a 500. A sign-in still fails if the check fails.
- A session that can no longer be used (suspended, merged or signed out) goes to `/api/session/end`, which clears its cookie. Before, the signed-in shell tried to sign out while rendering, which failed every page with a 500.

Migration: `20261112090000_protocol_intake`. Tests:
- `src/lib/intake/intake.unit.test.ts`: bindings and validation, Details changes reaching the F-27 print, the F-27/F-28/F-30/F-38 prints, F-36 point for point against the Word file, reviewer columns hidden from proponents, every scoping rule, intake gaps, and number parsing.
- `src/server/intake/intake.db.test.ts`: a new protocol on 11-01 without F-29, section saves with audit, adviser refused, conflicts, N/A in the bound values and the reference list, a Details change voiding an F-27 signature, withdrawal voiding a linked signature, and the backfill with its log and second run.
- The 2026 cycle test fills the intake and checks the F-26 suggestions. The seed test checks the new start, 11-01, F-29 retired for new protocols, and the slash label. The 2025 cycle test is unchanged and passes.

### Answers the REC gave on 12 Nov 2026

1. 11-01 applies at once, with the rest of the November process.
2. Funding stays on Details (the protocol), not in the intake.
3. F-30 items are free text, with the official items as a guide. The fee is an estimate, and the proponent picks its column.
4. Scoping follows only what the Word files say. F-35 2.10 also covers vulnerable participants, low literacy and indigenous peoples, so `minors=false` does not mark it N/A.
5. F-36 is the reviewer's checklist. Proponents only point to the paragraph and line, so the gateway has no proponent cell and nothing proponent-entered prints on it.
6. Version label: see above.
7. F-26 rows 5–10 are left to staff.
8. F-27 prints every researcher, each with their own sign-off date.

### Deviation from the request

- The acceptance item "hides A.07, 2.10 and 3.02–3.10" now hides A.07 and 3.02–3.10 and keeps 2.10, per answer 4.
- The intake gained `actions` (F-38 actions taken, per open point) and `section_revisions` (for conflicts). Without `actions`, the proponent would still type into F-38.
- The backfill runs as a script and from the seed, not inside the SQL migration. Its log is a hash-chained audit event, which only the application can write.
- The intake page shows the F-28 consents and links to the full privacy statement on F-28 rather than repeating it.
- The F-36 gateway is not bound to `scoping.consentNeeded`, per answer 5. A "no" still marks the rest of F-36 N/A, with the waiver reason as the reason.
- PDF output was not checked here: no Gotenberg service is configured locally. DOCX output is checked by the unit tests, and PDF converts that same DOCX.
- Checked by hand on 12 Nov 2026 with a new researcher-funded protocol on the dev database:
  - F-27 shows every Details value with nothing to type.
  - F-30 opens only the Personal column.
  - "No" to minors removes A.07 from the reference list, and F-36 prints NA for it.
  - The F-27, F-28, F-30, F-35 and F-36 Word downloads print those values in the official layout.

## Google sign-in for any account, and the client type from the leader's profile (2026-11-11)

**Google sign-in.** "Continue with Google" no longer asks Google for @usc.edu.ph accounts only (`hd`). Any Google account works: USC, another organization's Google Workspace, or a personal Gmail account. Accounts outside `auth.autoApproveDomains` still wait for an administrator's approval, as accounts made with a password do. The line under the button says so.

**Client type.** It used to be only a suggestion in the REC Staff dropdown, saved only when staff pressed Save, so a protocol nobody had looked at could not be billed. Now:
- **On submission** (completing the workflow's start step), the protocol gets the client type the rules give, unless REC Staff already chose one. This is audited as `protocol.client_type_set` with no actor and `suggested: true`.
- **Before a bill is priced**, the same rules are tried once more for a protocol that still has none.
- **REC Staff** change it on the protocol page as before. The rules never replace a type staff chose, and a bill already issued keeps its amount.

The rules can now read the leader's program, course, department, office and position, and the source of funds on the application form. That form and field are named by the new setting `fees.clientTypeFunds`, seeded as F-27 `funds`. A condition can be a value, a list, `{ "matches": regex }` or `{ "not": ... }` (`src/lib/fees/client-type.ts`).

The seeded `fees.clientTypeRules` now covers all nine client types (table in `docs/PROCESS-UPDATE-2026-11.md` → Fees). The seed replaces the earlier M14 rules where a database still holds them unchanged, and leaves a value staff edited alone.

Tests: `src/lib/fees/client-type.test.ts` places every profile kind. A new cycle in `zz-usc-rec-2026.cycle.test.ts` covers USC faculty with agency funding: submission sets the grant type, REC Staff change it to research workload, and the bill charges ₱4,500.

### Still to confirm

Three questions are in `docs/PROCESS-UPDATE-2026-11.md` → Fees:
- Whether any institution or agency funding counts as a research grant.
- Whether Senior High needs its own level in the profile.
- What rate an external faculty member without a grant pays.

## M14 — USC REC seed, November 2026 (2026-11-11)

`pnpm db:seed` publishes the November 2026 process (`docs/PROCESS-UPDATE-2026-11.md`) beside the 2025 one. Every new form version, both workflow versions and the settings that change behaviour start on 1 Jan 2027 (Asia/Manila), the date the REC gave on 10 Nov. A protocol created before that date, including one already in flight, keeps the 2025 versions to the end, resubmissions included. All of it is seed data under `prisma/seed/usc-rec/` (`forms-2026-11.ts`, `points-2026-11.ts`, `workflows-2026-11.ts`, `install-2026-11.ts`). If the REC moves the start, change `PROCESS_START` and the printed dates in `forms-2026-11.ts`.

**Templates.** The thirteen Word files from `docs/forms/2026-11/` are in `docs/forms/source/` under their full names. F-31, F-37, F-38, F-39 and F-41 now print on the official files, and F-40 Certification of Approval and F-42 Certification of Exemption from Review are new forms with placeholder maps. `scripts/prepare-templates-2026-11.ts` writes `templates/2026-11/`, the seed stores each template beside its form version, and `pnpm templates:check` checks the 2025 and 2026 sets against their own versions. See `docs/TEMPLATES.md` → November 2026 set.

**Forms.** Every form has a new version. F-26, F-31, F-35, F-36, F-37, F-38, F-40 and F-42 print 01/01/27; F-27, F-28, F-30, F-39 and F-41 print 08/01/25, as their Word files do. F-35 and F-36 follow version 10-00: 36 protocol points (page and line), and an ICF checklist with the gateway question and parts A to D. Every point needs a comment and a recommendation, and every point has a **Needs revision** tick. The recommended action, justification, reviewer's printed name, date and signature are required. F-37 copies every point. The reviewers' words stay closed, and the Panel Chair (or the Vice-Chair or REC Chair who stands in) writes an overriding comment and recommendation beside them, then the recommended action and justification for each part. F-37 is signed by REC Staff, by the Panel Secretary on full review, and by the chair. F-38 carries the open points only and is signed by every researcher and the adviser. Each reviewer remarks on the points they raised and ticks **Still needs revision**. F-40 and F-42 are signed by the deciding chair, and every researcher signs the F-40 Conformé. F-29 is not in the 2026 set or the 2026 graphs. F-26 stays staff-completed.

**Settings.** From 1 Jan 2027: code pattern `{YYYY}-{###}-{LEADER_FAMILY}{ET_AL}`, version label `{N}-{DDMMMYYYY}`, and meeting days Panel 1 first Friday, Panel 2 second Friday, Panel 3 third Friday, each with the 14-day cutoff. Until then `meetings.schedule` holds the 2025 rule (second Friday, 14 days), which M13 had removed from code. Seeded now, because only the 2026 versions read them: nine client types and the fee schedule of the 9 Dec 2025 memo, effective 1 Jan 2026, with 3rd-to-Nth review, amendment and continuing review at 50% of the base and graduate students free; the 70/20/10 distribution; the payment instructions, title and "Certified correct" line (REC Staff) of the billing template; client-type suggestions from the leader's profile; and certificate periods of one year, a progress report at six months, and continuing review 30 days before expiry. Existing settings are not overwritten.

**Initial submission.** The proponent submits F-27, F-28, F-30, F-35, F-36, the manuscript and the cover letter, with no fee receipt. REC Staff screen within 3 working days, and the code is assigned. The deciding chair (`FIRST_AVAILABLE` Panel Chair → Panel Vice-Chair → REC Chair) fills F-31 within 2 working days, plus F-41 when exempt, with a note to reviewers and a review due date. They choose Exempt, Exempt with recommendations, Expedited or Full, and assign one Scientist (F-35) and one Non-scientist (F-36).
- Exempt with recommendations reopens version 1 for the proponent (`REOPEN_VERSION`), then the chair checks again: Qualified, Qualified with recommendations, or Not qualified (back to the type of review).
- Exempt: bill → staff verify payment and prepare F-42 → the deciding chair signs F-42 → release within 3 working days → Exempted.
- Expedited and full: the bill is issued on the type of review and the review does not wait for it. The designation is deemed accepted after 72 hours, and a decline opens a re-designation of that slot. The assessment takes 10 working days, and the chair reviews F-37 within 2 working days.
- An expedited protocol the chair would disapprove becomes full review (`setFields` with a condition) and goes to the meeting with the same reviewers. Full review: staff record the meeting date and decision, then REC Staff and the Panel Secretary sign F-37.
- The chair endorses F-37 and signs F-39; when approved, staff prepare F-40 and the chair signs it. Release takes 5 working days and waits for the bill, which REC Staff may override with a reason.
- Release sends F-40 and keeps F-39 when approved. Otherwise it sends F-39 and F-37, with the chair's words in place of overridden ones (staff keep both). After approval, every researcher signs the Conformé and staff file it.

**Resubmission.** The proponent uploads the revised manuscript and completes F-38 for the open points. Researchers and the adviser sign. Staff screen within 3 working days. Round 3 and later are billed with `NTH_REVIEW`. The same reviewers remark within 10 working days, and the deciding chair decides. After major modifications the meeting decides; after minor it does not. Release sends F-40 and keeps F-39 and F-38 when approved. Otherwise it sends F-39 and F-38 without the reviewers' names and signatures.

**Panels.** With `SEED_DEMO=true` the seed imports `docs/forms/2026-11/REC members.xlsx` through the `/admin/panels` importer. The demo Panel Chair account is gone: panel roles come from the workbook. Staging and production import the workbook on `/admin/panels`, and the seed holds no real names.

**Engine and tool changes M14 needed.** These are generic, with no name, amount or day count:
- `OFFICE_ROLES` in `src/lib/signatures/target.ts` includes Panel Vice-Chair and Panel Secretary. Without it neither could sign F-37, F-39 or F-40 in the chair's or secretary's place.
- `feeBlock` takes `billsOnly`. A workflow with an `ISSUE_BILL` action checks only the current round's bill, so a round with no bill (the second review, or a protocol staff could not price) owes nothing. Before, it fell back to the 2025 receipt check, which nobody can satisfy or override, and blocked the release.
- A release package binds the `certificate.*` dates for every released form, so F-40 and F-42 print their dates although they are signed forms, not template-only certificates.
- The workflow simulation honours a `setFields` condition and gives transitions the outcomes chosen so far (`decisions.*`). Before, it always applied a conditional field and stopped at any transition that reads an earlier decision.
- `replaceInCell` and `replaceAcrossRuns` in `src/lib/docs/ooxml.ts` tag text that Word split across runs. `scripts/prepare-templates.ts` exports its tagging, and runs only when called directly.
- `pnpm db:seed` runs with `--conditions=react-server`, so the seed can use the storage and panel-import modules.

Tests: `src/server/workflow/zz-usc-rec-2026.cycle.test.ts` has five cycles:
- Exempt with recommendations: version stays 1, and F-42 is issued only after payment.
- Expedited approved: F-40 is sent and F-39 kept.
- Expedited disapproved goes to full review.
- Full review with a Panel Chair conflict: the Vice-Chair decides and signs F-39, and the letter names the Vice-Chair.
- Resubmission round 3: billed at 50% (₱800 on ₱1,600), and F-38 sent without the reviewers' names.

`usc-rec.seed.test.ts` checks the 2026 forms and graphs and walks every review type in the simulation. It also runs the seed twice and confirms nothing changes the second time, and that a protocol created first stays on its 2025 workflow and forms. The 2025 cycle test now refreshes only the form versions in effect.

### Confirm items that used a default

None of the "Still to confirm" items had an answer, so each one below uses its default. The defaults are also written in `docs/PROCESS-UPDATE-2026-11.md`, and each is a setting, a form version or a graph change.

1. F-26: staff complete it.
2. Reviewer slots: panel members, vice-chairs and secretaries by `isScientist`; no Independent Consultant and no third reviewer.
3. F-37 sent to the researcher: the chair's words where the chair overrode (`showOriginal: false`).
4. "3rd review" is round 3, the protocol version number.
5. 72 hours are calendar hours.
6. The adviser does not sign the F-40 Conformé.
7. Expedited disapproved → full review keeps the same reviewers.
8. Existing codes are kept; the new pattern applies from 1 Jan 2027.
9. The resubmission decision uses the same chair fallback.

The milestone prompt's own defaults that the REC had already answered on 10 Nov follow the answer:
- F-37: the chair does not edit the reviewers' words. The chair's comment overrides them, as M13 item 14 built it.
- Billing: as the default said, with staff allowed to release unpaid with a reason (`feeOverride`).

### Deviation from the request

- The prompt numbers the Confirm items differently from `PROCESS-UPDATE-2026-11.md` ("Confirm 3" for the F-37 edit, "Confirm 4" for billing, "Confirm 8" for the escalation reviewers). This entry uses the file's numbering.
- The tick column keeps the id `needs_action`, labelled **Needs revision**. The form renderer and the prefill strategies find the flag by that id; renaming it would lose the chair's highlight on screen.
- The Word templates of the 2026 versions live in `templates/2026-11/` and are stored on each form version. The 2025 templates in `templates/` are not overwritten, because a 2025 version falls back to `templates/{code}.docx` and in-flight protocols must keep printing the 2025 layout.
- Stored version names follow the printed number where it is free (F-26, F-31 and F-42 are 10-00; F-40 is 09-01). Otherwise they take the next revision of the 2025 name: F-27, F-28, F-30, F-39 and F-41 print 09-00 and are stored as 09-02, and F-35 to F-38 print 10-00 and are stored as 10-02.
- F-29 stays published for protocols created before 1 Jan 2027. Retiring it now would break the 2025 graph those protocols use. No 2026 version or graph uses it.
- F-41 is filled on the type-of-review step but is not required there, because a step's forms are required for every outcome. The exemption recheck step requires it.
- Both F-38 reviewer blocks (protocol part, ICF part) are optional. Both reviewers hold the same role on the protocol, so the form cannot require one block of one reviewer only. The remarks on each reviewer's own points are required.
- Slot forms also set `perAssignee`, so the step checks the slot reviewer's own copy. M13's slot test used optional forms and did not reach this.
- An expedited bill is not re-priced when the protocol moves to full review. Whether the full-review rate then applies is a question for the REC; the seed does not issue a second bill.
- The F-40 and F-42 details (type of review, meeting date, funds, study site, panel number) are filled by REC Staff on the step before the chair signs. There is no binding yet that copies them from F-27 or the panel.
- The cycle tests stub PDF conversion, and run on protocols dated on the start date. The bills in those tests come from a copy of the memo schedule dated today, which the tests remove afterwards, because other tests add their own schedules to the shared database.

## M13 — Process flexibility (2026-11-11)

The engine gains the kinds of behaviour the November 2026 process needs. Each one is configured from a workflow graph, a form definition, or a setting. No REC name, amount, day count, form code, or signer is in the new code. The USC REC seed is unchanged; M14 uses these capabilities.

**Panel roles and conflicts of interest.** Panel Vice-Chair, Panel Secretary, and Panel member are seeded as per-panel roles. Vice-Chair and Secretary have one holder per panel, like Panel Chair. Panel grants carry member attributes: designation, isScientist, discipline, affiliate, alternate. A new assignee rule, `FIRST_AVAILABLE`, tries an ordered list of rules, for example Panel Chair → Panel Vice-Chair → REC Chair. It skips the protocol's proponents and advisers and anyone with a `ConflictDeclaration` on it. Any open task on a `FIRST_AVAILABLE` step or a reviewer step shows **Declare a conflict of interest**. The task moves to the next person in the chain, or for a reviewer it opens a re-designation, and REC Staff are notified (`conflict.declared`). Generated letters use the person who completed the deciding step (`rec.signerName`, which also fills `rec.chairName`).

**Reviewer slots.** `assignReviewers.slots` chooses one reviewer per slot. Each slot has eligible roles, required grant attributes such as `{ "isScientist": true }`, and its forms. A step form with `slot` opens, and is required, only for that slot's reviewer. Graphs without slots still use roles/min/max and `perAssignee`. Assignments are stored as `[{ userId, slot }]`, and the reader still accepts the old `string[]`. The picker lists eligible members of the protocol's panel first, then alternates, then everyone else with an eligible role.

**Deemed acceptance and re-designation.** With `onTimeout: { outcome }`, the SLA scan completes an open task whose deadline has passed. It acts as the system (no completing user) and is audited as `task.timed_out`. `decline: { outcome, redesignateBy }` closes a declining reviewer's task as DECLINED. A decline needs a reason, set with `requiresComment` on the outcome. A re-designation task then opens for the chair. It replaces only that slot and opens the acceptance task for the new reviewer only; the other reviewer's task carries on. The step does not complete while a re-designation is open. `capture.noteToReviewers` and `capture.reviewDueDate` show on the reviewers' tasks and in the `task.assigned` email.

**Correction without a new version.** The `REOPEN_VERSION` action (`params.forms`) sets the frozen version back to WORKING under the same number and label. The named forms become editable again. Submitting freezes it again, and the `protocol.version_submitted` audit event lists the changed form fields and the files added or removed. The database triggers allow this one change only when the transaction sets `recdms.version_reopen`.

**Protocol codes.** `protocol.codePattern` accepts `{YYYY}`, `{###}` (padding from the number of `#`), `{LEADER_FAMILY}` and `{ET_AL}`. The sequence is per year (`code_counters`), is never below a code already issued under the current pattern, and is unique. Codes already issued never change.

**Fees and billing.** New tables: client types, dated fee schedules, rates (client type × EXPEDITED/FULL/EXEMPT, in centavos), rules (a percent of the base rate, with an optional first round), and bills. `ISSUE_BILL` (`params.basis`: `reviewType`, `nthReview`, or a rule key) prices the bill from the schedule in effect on the issue date. It runs after the step's `setFields`, so it sees the review type just chosen. A zero amount is recorded as WAIVED. A protocol with no client type or no rate does not block the review; REC Staff get `fee.bill_not_issued` instead. The statement of account is a PDF job built from the settings `fees.description`, `fees.paymentInstructions`, `fees.statementTitle`, and `fees.certifiedLabel`. Proponents upload proof of payment against a bill while it is open, even with the version frozen. REC Staff record it as paid, part paid, or rejected, on the protocol page or the Fee receipts list. `feeVerifiedOutcomes` checks the bill for the current round, falling back to the receipt check when no bill exists. With `feeOverride`, REC Staff may still choose the outcome after typing a reason. This is audited as `fee.release_override` with the amount outstanding, and the bill stays on the Fee receipts list. `/admin/fees` (REC Staff, System Admin) has client types, schedules with a client type × basis grid and rules, a preview calculator, and a report of bills by month, panel, and client type, split by `fees.distribution`. A schedule that priced a bill cannot be edited. The client type is suggested from the leader's profile by `fees.clientTypeRules` and set by staff on the protocol page.

**Meeting days.** `meetings.schedule` gives a weekday, a week of the month (−1 for the last), and a cutoff in days, as a default and per panel code. The meetings report groups by panel and date. The cutoff badge and the meeting-date default read the same rule. The fixed second Friday is gone. Without the setting, protocols are listed under "No meeting day set".

**Release packages, redaction, overrides.** `release: { [decision]: { send, keep } }` lists form codes or `certificate:<code>`. Send copies are generated with audience PROPONENT; keep copies, and the full copy beside a changed send copy, with audience STAFF. Proponents and advisers see and download only PROPONENT copies of a released form. A send item can carry `redact: [field paths]`, which leaves those fields and their signatures out of the generated copy only, and `showOriginal: false`, which prints an overriding column in place of the original. A form table column can declare `overrides: "<column>"`. The chair fills the override, and the reviewer's text is never changed. Prefill and the next round's F-38 use the overriding text. Placeholder maps can mark `assessmentRows` with `highlightIf: "<flag column>"` to print flagged points with a yellow highlight in Word.

**Small graph additions.** `setFields` takes `from: "value"` with a `value`, and an optional `when` condition. Conditions can read `parent.decision` and `protocol.round` (the protocol version number). `protocol.versionLabel` sets the label pattern (`{N}`, `{DDMMMYYYY}`, …). Its default stays `{N}/{DDMMMYYYY}`.

**Moving a running protocol.** On the protocol page, a System Admin can switch on "Allow moving this protocol to another version". They then pick a published version of the same workflow, see which step keys carry over, and choose where to resume. Completed history stays, and open tasks close with a note. The move is audited as `workflow.migrated` (the switch as `workflow.migration_toggled`). It is off by default and never automatic.

**Panel import.** `/admin/panels` → Import from a spreadsheet reads the `REC members.xlsx` layout: Panel (filled down), No., Name, Designation, Discipline, Affiliation, Email, and a second email. The preview lists panels to create, new people (an account is created and `panel.added` is sent), designation changes, and removals (revoked with the reason "Panel list import"). Nothing changes until staff confirm. Open tasks are not moved, and importing the same file again changes nothing. Designation words map to roles through `panels.importRoles`.

**Effective dates.** A form version, a workflow version, and a setting can be published with a future start date. The version used depends on when the protocol was created, so a protocol started earlier keeps its version. A form or workflow version already in use on a protocol stays in use. The SLA cron records `form.version_effective`, `workflow.version_effective`, and `setting.version_effective` once on the date, and writes a scheduled setting into `settings`. The admin screens show "Scheduled for …" and allow cancelling before the date. `/admin/settings` (REC Staff, System Admin) edits process settings as JSON, now or from a date. The printed form date (`effectiveDate`) stays per form.

**Certificate dates.** Certificates get `certificate.releaseDate`, `certificate.validUntil`, `certificate.progressReportDue` and `certificate.continuingReviewDue`. These come from the release date and the settings `certificates.approvalPeriod`, `certificates.progressReportAfter` and `certificates.continuingReviewBefore`.

**Builder and simulation.** The step form edits the `FIRST_AVAILABLE` fallback order and outcome reasons. A form line can end in `|each` or `|slot:KEY`. The step form also has the timeout outcome, the decline outcome and its re-designator, the captured facts, the fee outcomes and override, and JSON boxes (checked against the step schema) for reviewer slots, release packages, actions, set fields, side tasks, and the whole step. Publish takes an optional start date. The simulation lists, for each step, the assignee chain, slots, timeout, decline, bill, fee check, and release package. It takes the timeout outcome when no choice is given, and can start from a review type and a round.

Migrations: `20261111090000_process_flexibility`, `20261111090100_bill_upload_intents`, `20261111090200_reopen_and_schedules`. Tests: `src/server/workflow/m13.engine.test.ts` (database, one case per acceptance criterion) and `src/lib/m13.unit.test.ts`. The existing seeded graphs parse and validate unchanged, and `zz-usc-rec.cycle.test.ts` is unchanged.

### Deviation from the request

- A third per-panel role, **Panel member** (`PANEL_MEMBER`), was added. The import needs a panel grant to hold a scientist or non-scientist member's attributes, and Primary Reviewer and REC Member are global roles.
- Vice-Chair and Secretary count as committee staff for reviewer-name visibility, and open the Panel Chair view, as Panel Chair already does.
- The conflict-of-interest declaration is a built-in action on every eligible task, not a side task in the graph. It is offered wherever the step's assignee is `FIRST_AVAILABLE` or assigned reviewers.
- The statement of account is a generated PDF whose text comes from settings, not a fill of the billing `.xlsx` template. The system has no spreadsheet renderer.
- The yellow highlight is a placeholder-map option (`highlightIf`). It is not switched on in the current F-35–F-38 maps, because this milestone leaves the seed and templates unchanged. M14 sets it. The "next round's F-38 carries forward only rows still flagged" behaviour already existed (`prepareActionSummary`) and was kept.
- Proponents' downloads of a form are limited to its PROPONENT copy only for forms released with an audience. Forms released by older graphs keep the earlier rules.
- With no `protocol.codePattern` setting, the legacy `USC-REC-{YYYY}-{####}` default remains, so published graphs and existing tests behave as before.
- A meeting-day setting is required for the meetings report to group by date. Its earlier hard-coded second Friday and 14-day cutoff now live only in the setting. `reports.test.ts` sets it.
- The partial unique index `workflow_versions_one_published` now allows scheduled versions beside the one in effect. The submitted-version and locked-form triggers gained the `recdms.version_reopen` path.
- Accounts created by the panel import are ACTIVE with the imported email marked verified, and sign in with Google or a one-time link. A grant needs an account, and there is no separate invitation record for committee members.
- `notify` emails for new templates (`fee.bill_issued`, `fee.bill_not_issued`, `conflict.declared`, `review.redesignate`, `panel.added`) are in the catalog. The `task.assigned` default body adds the review due date and the note. Templates already in a database keep their stored text until edited at `/admin/notifications`.
- The settings screen is new. It is gated as `settings.data` for REC Staff and System Admin, matching "Layer 1: REC Staff or System Admin" in `docs/PROCESS-UPDATE-2026-11.md`.

## Needs-action flag on F-35–F-38 (2026-11-10)

F-37 and F-38 no longer treat every comment as work for the researcher. Reviewers tick **Needs action from researcher** on each F-35 / F-36 point. Specific Recommendations starts as “No recommendations”; if the reviewer changes that text, they must tick or untick the flag before submit (the form lists points that still need that choice). Proponents do not see the flag. Chair views of F-35 / F-36 and F-37 highlight flagged points with `warning-soft`, an icon, and the words “Needs action”.

F-37 copies only points any reviewer flagged. The chair can unflag a point or add another during consolidation. F-38 shows only those flagged rows, with panel comments under “Panel/Reviewers' Recommendations”; Actions Taken and page/paragraph stay for the proponent; Reviewer's Remarks start blank on every resubmission; each row has **Still needs action**. The next pass carries forward only rows still flagged. Printed F-35–F-38 maps still match the official templates (the flag is not printed).

Published as form version `10-01` for F-35, F-36, F-37, and F-38. Earlier published versions are retired on seed; protocols already in review keep their definition ids.

### Deviation from the request

- Assessment columns gain a `checkbox` type plus optional `defaultValue`, `visibleToRoles`, and `requireExplicitIf` so the flag stays in the form schema rather than hard-coded REC rules in TypeScript.

## Upload limit, F-29 email, F-36 “If NO…”, and spell-check (2026-11-10)

The default `uploads.maxBytes` is 100 MB (was 25 MB). The uploads panel help text shows that setting. `docs/DEPLOY.md` notes Supabase’s free plan 50 MB file cap.

F-29’s researcher table requires name and email; opening a draft form pre-fills rows from each proponent’s contact email, name, and designation. F-36 row `1.NO` uses `visibleIf` / `requiredIf` so it appears and is required only when item 1 is No; the print map still reads the same paths. Assessment rows may carry those conditions in the form schema.

Those form changes publish as version `09-01`. Seeding retires earlier published versions of the same code so new protocols get `09-01` while existing form instances keep their old definition id.

`pnpm lint` and CI run cspell on `src/**/*.tsx`, notification templates, and USC REC seed labels, with an allow-list for REC and stack terms.

### Deviation from the request

- Designation and CV appendix on the researcher table stay optional; only name and email are marked required, matching the adviser block’s pattern.
- `docs/SECURITY.md` was updated to the same 100 MB default so it does not disagree with the setting.

## In-app document viewer (2026-11-10)

Opening a file no longer uses `window.open` in a new tab. A large in-app panel shows the file name, protocol code, Close (also Escape and the browser Back button), Download, and a small “Open in new tab” link. PDFs use the browser’s built-in viewer in an `<object>` / `<iframe>` on a white plate; images show on the same plate; DOCX and other types offer Download. Signed URLs still expire in five minutes and refresh while the viewer stays open. Opening a file is still audited.

The viewer is used from Uploads, fee receipts, the protocol logbook for generated PDFs (including F-39), form “View PDF”, and the manuscript control on review form screens. On wide screens, a review form that has a manuscript sits beside that manuscript. Focus moves into the viewer and returns to the control that opened it. Reduced motion keeps the open/close fade without the rise.

### Deviation from the request

- “Print” on form and sandbox pages is labelled “View PDF” because the action opens the in-app viewer rather than the system print dialog.
- Side-by-side manuscript layout appears when the form is tied to an open workflow step (`stepKey`), which is how review screens reach the form.

## Autosave flush on leave (2026-11-10)

Form field edits no longer wait only on the 800 ms debounce. `flushAll()` saves every pending field at once, in order, with the same conflict handling as a normal save. It runs when the form unmounts or the App Router route changes, before Return / Complete / Sign / Submit on the page, and when the tab hides (`visibilitychange` / `pagehide`) through `sendBeacon` or a keepalive `POST` to `/api/forms/[instanceId]/fields` (same authorization and validation as `saveFieldAction`). If a save is still pending or failed, the browser’s unsaved-changes warning appears. Assessment tables use the same queue; the sandbox form does too. Task comments still go with the Complete action (they are not debounced).

### Deviation from the request

- In-app link clicks that leave a dirty form are intercepted so `flushAll` can finish before navigation; a bare unmount alone cannot reliably await the saves.
- A failed field is kept in the pending map so `flushAll` and `beforeunload` still see it.

## Admin screen permissions (2026-11-10)

The remaining admin screens use `authorize()` the same way `/admin/users` does. An address in `BOOTSTRAP_ADMIN_EMAILS` still counts as a System Admin only while no active System Admin exists.

- `/admin/audit` and its CSV export: REC Staff, REC Chair, and System Admin (`audit.view`).
- `/admin/forms`, `/admin/workflows`, and `/admin/notifications`: System Admin only (`forms.edit`, `workflow.edit`, `settings.edit`).
- `/admin/holidays` and `/admin/retention`: REC Staff and System Admin (`holiday.edit`, `retention.review`).

The sidebar shows those links only when the person passes the matching check. `/admin/users` again links to Forms and Audit log for people who can open them.

## Action results (2026-11-10)

After an action succeeds, a confirmation dialog says what happened and who acts next. Its OK button goes to the next place to work. Closing the dialog with Escape or a click outside does the same. Errors stay inline on the same page, above the button, and the fields keep what was typed.

The dialog covers completing a workflow task (submit, screen, return, decide, release, review), Submit version, Request extension, and signing a form. Claiming a task, reassigning one, and starting a revision still stay on the page with no dialog, because the next thing to do is on that page.

The second line comes from the open tasks of the workflow's next step: the step name, the role or person assigned, the step's deadline, and the due date. A role task shows the role, for example "REC Staff acts next: Screen the submission, within 2 days (by 12 Nov 2026)." A person shows by name, and proponents and advisers still see "Reviewer" in place of a reviewer's name. When the pass has ended it says so. The first line is "Protocol submitted." when the project leader completes the workflow's first step, "Returned to Juan D. Cruz with your comment." when the chosen outcome leads to a Returned status, and otherwise the step name with the outcome label.

Where OK goes:

- A reviewer's task goes to My reviews (`/app/reviews`).
- Signing a form goes to the protocol's Forms page.
- Everything else goes to the protocol page.

Saving a form field still stays on the form with the autosave caption. The top bar on every protocol page now reads Dashboard / protocol code / tab, and a form adds its form code. Each part links back.

`ActionForm` and `ActionResultProvider` in `src/components/ui/action-result.tsx` are the shared pattern. An action returns `{ ok: true, result }` or `{ ok: false, error }`. `resultHref` in `src/lib/action-result.ts` chooses the destination. The dialog is the existing Dialog, so reduced motion gets the 120ms fade with no movement.

### Deviation from the request

- "Within 2 days" is followed by the step name, not a verb such as "check it". The workflow stores no verb for a step, and the rules forbid hard-coding one per step.
- The role's home in the breadcrumb is the Dashboard at `/app`, which is where every role view opens.
- No form in a protocol had a submit action. Signing is the only form action that is not an autosave, so it is the one that returns to the Forms page.
- `completeTaskAction`, `submitVersionAction`, and `requestExtensionAction` no longer redirect with `?error=`. The protocol page still reads `?error=` for claim and reassign.
- The Playwright file `e2e/action-result.spec.ts` creates its own unpublished workflow (`E2E_ACTION_RESULT`) and two accounts in the development database, as the assessment tests do.
- When the destination is the page the user is already on, OK only closes the dialog. The action has already refreshed that page.
- `src/server/db.ts` now sets Prisma's `transactionOptions.maxWait` to 20 seconds (the default is 2). After OK, the next page can load while the old page is still refreshing. With `connection_limit=1` the second request failed with P2028 and showed the error page. It now waits for the connection.
- `.claude/launch.json` is new. It lets the Claude preview start `pnpm dev` on port 3000.

## Navigation links (2026-11-10)

In the REC Staff and REC Chair views, people who pass `users.manage` now see Users linking to `/admin/users`, and a new Panels link. Others in those views keep Users linking to `/app/users`, and do not see Panels.

The account menu now links to Sign-in methods, Authenticator, and Your data. The Revision deadlines count on the proponent dashboard opens `/app/revisions`.

An address in `BOOTSTRAP_ADMIN_EMAILS` with no roles has only the Proponent view, so it reaches `/admin/users` by address until it holds a role.

## User roles and panels (2026-11-09)

REC Staff and System Admins can now open `/admin/users` and `/admin/users/pending`, through `authorize(user, "users.manage")`. An address in `BOOTSTRAP_ADMIN_EMAILS` counts as a System Admin on these screens only while no active System Admin exists. Approving, rejecting, and merging accounts use the same check.

The user list shows each person's roles. Manage roles at `/admin/users/[id]` lists current roles, grants a role, and revokes one with a required reason. A role held per panel asks for the panel. Each change writes `user.role_granted` or `user.role_revoked` in the same transaction. Role changes run one at a time.

`/admin/panels` shows each panel's name, disciplines, Panel Chair, and members, with a link to `/admin/panels/[id]/chair` to change the chair. A change ends the old grant and starts the new one together. Open tasks stay with the old chair until REC Staff reassign them.

`pnpm db:seed` now creates the roles in `docs/SPEC.md`. Before this, only the demo seed created role rows, so each environment needs the seed run once.

### Deviation from the request

- Only a System Admin can revoke System Admin, and the last active System Admin cannot be revoked. The request limited only granting. Without this, REC Staff could remove every System Admin.
- Merging an account that holds System Admin needs a System Admin, because a merge moves roles onto the kept account.
- A panel has one chair. Granting Panel Chair on a panel that already has one is refused and points to the Panels page. With two chairs the engine leaves tasks unassigned.
- The revoke reason is stored in the audit event. `user_roles` has no column for it, and no migration was needed.
- Primary Reviewer and Independent Consultant are seeded as global roles, although `docs/SPEC.md` lists them per protocol. Workflow steps offer reviewers from standing grants, and the choice per protocol is made on the step.
- Panel members are people holding a role tied to that panel, other than chair. Panel Chair is the only per-panel role in the seed, so the list is empty until another role is made per-panel.
- `/admin/panels` is linked from Users rather than the sidebar. The sidebar is per view and would show it to Chairs who cannot open it. Forms and Audit log on `/admin/users` are restored for people who pass `forms.edit` or `audit.view`.

## Workflow task comments (2026-11-09)

A comment entered when completing a workflow task now appears on the protocol page and the Forms page, newest first, with the step, the outcome, who wrote it, their role, and the date. While a protocol is returned, the protocol page shows the latest return reason in a banner at the top. The banner goes away when the protocol leaves the returned status.

Proponents and advisers see "Return incomplete" and other comments from before the review stage at once. Reviewer and Chair comments stay hidden from them until the decision on that pass is released. Reviewer names show only to REC Staff, Chairs, and administrators. Everyone else sees "Reviewer", in these comments, in the open tasks and history of the Review section, and in the protocol Activity timeline. The Roster and Members page leave reviewers out for those viewers, apart from a reviewer's own row. This changes the display only: stored tasks and audit events keep the real person, and the admin audit page still shows full names. Someone who is a proponent or adviser on the protocol is treated as one even if they also hold a committee role.

These rules read the published workflow, not step names. A return is an outcome whose transition leads to a Returned status. The review stage starts at the step that freezes the version. A release is a step that generates documents. A workflow with no freeze step counts every step as review. No schema change was needed: the comment was already stored on the task.

### Deviation from the request

- The request asked for every comment and its author to be visible to all protocol members. `docs/SPEC.md` says proponents see review comments after release and do not see reviewer names. The spec was followed, as confirmed during this change.
- A return with no comment shows no banner, because there is no reason to show. The comment box is still optional.

### Also fixed

The F-27 print map still used the funding values from before the study catalogs. The funding checkboxes now read the current codes, and the agency, institution, and other blanks print those fields. The official form has no place for "Amount and name of each source", so that answer no longer prints.

## Sign-in page (2026-11-09)

The sign-in page is a single column: Google, then one shared email field that switches between a password and a one-time link. The link expires in 24 hours. Google receives `hd=usc.edu.ph` as a hint; other Google accounts can still sign in. Sign-up and email verification keep the previous frame.

## Public front page (2026-11-09)

The signed-out page at `/` introduces REC-DMS: who uses it, the five submission stages, the checklist, forms and guides, and the REC office. Signed-in visitors still leave `/` for their start page. Wording and links live in `src/lib/site-content.ts`. The stages and the checklist are the same lists as the proponent dashboard. Office hours are the Talamban weekday hours and can be edited in that file.

## Proponent dashboard (2026-11-08)

The proponent home at `/app` is a summary strip, an attention list, and a short protocol table. Someone with no protocol sees the submission steps and the checklist in `src/content/submission-checklist.ts`. My tasks shows a count when work is waiting. The notification bell uses a gold dot for unread notices. Other role dashboards are unchanged.

## Names and affiliation profiles (2026-11-08)

A person's name is stored in parts: title, first name, middle name, family name, suffix, and a list of credentials. The person enters the middle name once. Screens and submitted forms use the first letter of that name for the short form (`Juan D. Cruz`). The stored middle initial is that letter, not a second answer. Submitted forms also print the title and degrees.

Affiliation is a profile on the person. The kinds are USC student, outside student, USC faculty, USC staff, outside adviser, and industry partner. Proponent and adviser remain protocol roles. Schools, departments, offices, and programs are organization rows. The seed loads School of Engineering, School of Arts and Sciences, School of Architecture, School of Fine Arts and Design, School of Law and Governance, and under Arts and Sciences the departments DCLL, DCISM, Biology, and Physics.

Sign-up still asks for the name and the email. The profile is saved before a protocol is created or an invitation is accepted, then copied onto that membership. A later profile edit does not rewrite a submitted protocol. A `@usc.edu.ph` address is still activated from the domain. The shape of the address only suggests which form to open. `importDirectory` links a registrar or HR row to the account on creation when the verified email matches. No roster is seeded.

### Deviation from the spec

- Credentials are a text array. The name and the affiliation are columns and foreign keys, not a JSON document.
- The membership still records `STUDENT` or `FACULTY` so existing form and workflow branches keep working. The specific kind is `profileKind`.
- The directory import is a function. An admin screen for the organization list and a CSV upload are not in this slice.
- Only the schools and departments named above are seeded.

## M12 — Hardening and deployment (2026-11-07)

The deployment is Vercel in Singapore, a separate Supabase project in Singapore, and Google Cloud Run in Singapore for PDF conversion, virus scanning, and the nightly backup. Cloud Scheduler calls the cron routes. There is no on-prem server. The old compose file is in `deploy/archive/usc-server/` with a note that it is not used.

Production requires the cron secret, the public origin, and the scanner settings. Local development still starts without Gotenberg or ClamAV. `recdms_app` is created `NOLOGIN` with no password in the migration. `CREATE ROLE` cannot run inside a transaction, so that migration is marked `-- prisma-migrate-disable-transaction`. The operator sets the password in the Supabase SQL editor. The role cannot update or delete `audit_events`. Row level security is on for every `recdms` table, with policies only for `recdms_app`, because that role does not own the tables. `anon` has no policy and no grants.

Gotenberg is pinned to 8.40.0, the last 8.x release, which has basic auth. The image installs Times New Roman. PDF conversion on Vercel is a background job. ClamAV is an HTTP wrapper in front of `clamd`. An infected file is blocked, removed from storage, and reported. The EICAR test string is the only mismatched upload that is kept long enough to scan.

Authenticator codes are required for REC Staff, Chairs, and System Admins. A person can download their own profile, emails, memberships, and signature list. Closed protocols older than three years are flagged for staff. Nothing is deleted automatically.

`/api/health` checks the database, storage, Gotenberg, ClamAV, and the age of the last backup stamp, and logs one database round trip.

### Not run from this workstation

The restore drill, the staging Playwright file, `pnpm fonts:check`, and the Cloud Run deploys need the operator’s Supabase, Vercel, and Google Cloud accounts. The commands are in `docs/DEPLOY.md` and `docs/RESTORE.md`. Record the drill result here after `scripts/restore-drill.sh` prints a verified chain.

### Deviation from the spec and the M12 prompt

- The spec still describes an on-prem server behind a tunnel. The decided deployment is Vercel, Supabase, and Cloud Run, all in Singapore. The prompt file in `prompts/` still describes the tunnel. This changelog follows the decided architecture.
- `recdms_app` has row level security policies. The prompt asked for no policies. Postgres would then return no rows to a role that does not own the tables and does not bypass row level security. `anon` and `authenticated` still have none.
- `public` on the development project was not altered. It holds another application’s tables.
- Gotenberg’s `/health` does not require basic auth. That is how Gotenberg 8.40 works. Conversion without the username and password returns 401.
- `pnpm audit` on 2026-11-07 reported 2 critical, 21 high, 25 moderate, and 5 low. The critical finding is `xmldom` (multiple root nodes), a transitive document-library dependency. Nothing in the application stack was upgraded for it in this milestone. Re-run `pnpm audit` before a release.
- The live `dbMs` measurement from `sin1` is for the operator to record after the first production deploy. `/api/health` logs the round trip.

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
