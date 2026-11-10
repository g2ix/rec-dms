# M14 — USC REC seed, November 2026 process

Depends on M13, and on the "Confirm with the REC" list in `docs/PROCESS-UPDATE-2026-11.md` being answered. Write the answers into that file before starting; where one is still open, use the default stated below and say so in the CHANGELOG.

Read first: `docs/PROCESS-UPDATE-2026-11.md`, `docs/forms/2026-11/` (workflow PDF, Annex J flowchart, fee memo, billing template, members list, Word forms), `prisma/seed/usc-rec/*`, `docs/CHANGELOG.md` → M08 and M10.

## Goal
Publish new versions of the USC REC forms and workflows that follow the November 2026 documents, using only M13's capabilities and the admin settings. Protocols already in flight stay on their versions.

## Tasks

1. **Templates.** Add the Word files from `docs/forms/2026-11/` to `docs/forms/source/` with their full names, replacing the rebuilt F-31, F-37, F-38, F-39 and F-41 templates with the official files. Add F-40 Certification of Approval and F-42 Certification of Exemption from Review as forms with placeholder maps. Run `pnpm templates:check`.
2. **Forms** (new versions, each with the effective date printed on its Word file through M13 item 12: F-26, F-31, F-35, F-36, F-37, F-38, F-40, F-42 on 2027-01-01; F-27, F-28, F-30, F-39, F-41 keep 2025-08-01. If the REC wants the new process before 2027, change only those dates):
   - F-35, F-36: every point requires comments and recommendations (no blanks); recommended action and justification required; reviewer name, signature and date required; `needs_revision` tick per point.
   - F-37: Panel Chair can edit comments, recommendations, recommended action and justification (default; see Confirm 3). Signature fields: REC Staff, Panel Secretary (full review only), Panel Chair.
   - F-38: researchers and adviser sign; reviewer remarks, recommended action, justification, name, signature, date; `needs_revision` tick.
   - F-29 is no longer used: unpublish it from new versions. F-26 stays staff-completed unless Confirm 1 says otherwise.
3. **Settings.** Code pattern `{YYYY}-{###}-{LEADER_FAMILY}{ET_AL}`; version label `{N}-{DDMMMYYYY}`; meeting days Panel 1 1st Friday, Panel 2 2nd Friday, Panel 3 3rd Friday; fee schedule from the 9 Dec 2025 memo, effective 2026-01-01, with all client types and the 50% rules; distribution 70/20/10; payment instructions and the "Certified correct" signer title from the billing template.
4. **Initial submission workflow** (new version):
   - Proponent submits F-27, F-28, F-30, F-35, F-36, manuscript, cover letter. No fee receipt at submission.
   - REC Staff screen (3 working days) → assign code.
   - Determine type of review: `FIRST_AVAILABLE` Panel Chair → Panel Vice-Chair → REC Chair, 2 working days, F-31, outcomes Exempt / Expedited / Full, slots Scientist (F-35) and Non-scientist (F-36), note to reviewers and review due date.
   - Exempt: same step also fills F-41; outcomes Qualified / Qualified with recommendations / Not qualified. With recommendations → `REOPEN_VERSION` → proponent revises → chair checks again. Qualified → `ISSUE_BILL` (exempt) → proponent pays → staff verify → F-42 signed by the deciding chair → staff release (3 working days) → End Exempted.
   - Expedited and full: bill per Confirm 4 (default: issue after the type of review, review does not wait for payment, release waits for verification) → accept designation (72 h, `onTimeout: ACCEPT`, decline → re-designate) → assess (10 working days, slot forms) → Panel Chair F-37 (2 working days) → full only: meeting outcome on the panel's day, REC Staff and Panel Secretary sign F-37 → Panel Chair signs F-37 and F-39 → release (5 working days; Annex J says 3–7).
   - Expedited disapproved → set review type FULL → meeting route (Confirm 8 default: same reviewers).
   - Release packages: Approved → send F-40, keep F-39; Minor/Major → send F-39 and F-37; Disapproved → send F-39 and F-37.
   - Approved → every researcher signs the Conformé on F-40 (the Word file says "Signature over printed name of researcher(s)/proponent(s)") → staff file → End Approved. F-40 and F-42 are signed by the Panel Chair who decided, with the approval period, progress report date and continuing review date from M13 item 13.
5. **Resubmission workflow** (new version): proponent uploads the revised manuscript and fills F-38 with only the open points; researchers and adviser sign F-38 → staff screen → round 3 and later `ISSUE_BILL` with `NTH_REVIEW` → same reviewers fill their F-38 remarks (10 working days) → Panel Chair decides (`FIRST_AVAILABLE`) → release packages: Approved → send F-40, keep F-39 and F-38; otherwise send F-39 and F-38 redacted (no reviewer name or signature). Parent decision Major → meeting route; Minor → no meeting.
6. **Panels.** Import `docs/forms/2026-11/REC members.xlsx` through the M13 importer in `SEED_DEMO` only. In staging and production, staff import it from `/admin/panels`; the seed does not hold real names.
7. **Tests.** Update `usc-rec.seed.test.ts` and add cycle tests for: exempt with recommendations (version stays 1, F-42 after payment); expedited approved (F-40 sent, F-39 kept); expedited disapproved → full; full with a chair conflict (Vice-Chair signs F-39); resubmission round 3 billed at 50% and F-38 sent redacted.

## Acceptance criteria
- `pnpm db:seed` publishes the new versions; a protocol created before the seed finishes on its old version.
- The five cycle tests pass, and the workflow simulation in `/admin/workflows` walks each review type with no validation error.
- No name, amount or day count was added to `src/`.
- `pnpm lint && pnpm typecheck && pnpm test` pass.

Write a CHANGELOG entry "M14 — USC REC seed, November 2026", listing which Confirm items used a default.
