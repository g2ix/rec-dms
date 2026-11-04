# M05 — Protocols, collaboration, uploads, versions

Read first: `docs/SPEC.md` → "Protocol lifecycle and collaboration", "Current USC REC process" (Review panels, Protocol code), "Data model" (Protocol group, files), "Security and data privacy".

UI: match the "Filling F-27 with co-proponents" and "Phone: F-35 page and paragraph" screens in the REC-DMS key screens canvas (paste screenshots into the chat).

## Goal
Proponents create a protocol, invite co-proponents and an adviser, fill shared details once, edit forms together, upload the manuscript, cover letter and fee receipt, and freeze a version on submit.

## Data model
- `Protocol`: id, code (nullable until assigned; unique), title, disciplineId, panelId (suggested from discipline, editable by REC Staff / Chair), reviewType (nullable: `EXEMPT | EXPEDITED | FULL`), status (string; set by workflow in M07, default `DRAFT`), leaderUserId, institution, institutionAddress, researchType, durationMonths, expectedParticipants, studySite, fundingSources Json, createdById, timestamps.
- `Discipline`: id, name, panelId (default mapping).
- `ProtocolMember`: id, protocolId, userId (nullable until invite accepted), invitedEmail, role `PROPONENT | ADVISER | PRIMARY_REVIEWER | INDEPENDENT_CONSULTANT`, isLeader, rosterOrder, contactNumber, designation (course & year / position), status `INVITED | ACTIVE | REMOVED`, invitedById.
- `ProtocolVersion`: id, protocolId, number, label (e.g. `2/28May2022`), state `WORKING | SUBMITTED`, submittedAt, submittedById, snapshot Json (shared fields at submit).
- `File`: id, protocolVersionId (nullable), kind `MANUSCRIPT | COVER_LETTER | FEE_RECEIPT | SUPPORTING | GENERATED_DOCX | GENERATED_PDF | SIGNATURE_IMAGE | TEMPLATE`, originalName, storageKey, mime, size, sha256, uploadedById, scanStatus `PENDING | CLEAN | INFECTED`.
- `FeeVerification`: protocolVersionId, status `PENDING | VERIFIED | REJECTED`, reason, verifiedById, verifiedAt.

## Tasks
1. Implement the `ProtocolMembershipReader` stub from M02 so `authorize()` uses real memberships.
2. Create protocol wizard: title (warn on ALL CAPS, REC rule), discipline → suggested panel shown, institution, research type and the other F-27 application details. Creator = PROPONENT + leader, rosterOrder 1.
3. Members tab:
   - Invite by email as PROPONENT or ADVISER. Existing user → notification + accept. Unknown email → email with sign-up link; when that person verifies any email equal to `invitedEmail`, the invite binds to their account.
   - Reorder roster (leader always first). Transfer leadership (leader only; audited). Remove member (leader only).
4. Shared details page binds to the `bind` paths from M04 (researchers list is derived from ACTIVE proponent members in roster order, formatted "First M. Family").
5. Forms tab: for the WORKING version, instantiate every form required for the submission type. Phase 1: use a temporary setting `protocol.requiredForms` (list of form codes) — M07 will take this from the workflow. Show per-form status (Not started / In progress / Complete / Needs signatures).
6. Collaboration:
   - Autosave and conflict handling from M04.
   - Presence: show avatars of members currently viewing the same form (poll every 15 s via a lightweight `presence` table or in-memory store; keep the interface swappable for websockets later).
7. Uploads:
   - Direct-to-storage uploads with presigned PUT; server confirms, records sha256 and size. Allowed: PDF for manuscript, cover letter and receipt; images also for receipt; max 25 MB (setting).
   - Suggested manuscript filename including version and date (REC rule); keep the original name too.
   - `scanStatus` stays PENDING (ClamAV wired in M12); show a neutral badge.
   - Downloads via 5-minute signed URLs, audited.
8. Versions:
   - `submitVersion(protocolId)` service (no workflow yet): leader only, active user only, all required forms valid, required uploads present → set state SUBMITTED, snapshot shared fields, lock form instances (status LOCKED), create the next WORKING version lazily when revision starts.
   - Field diff view between two versions (per form, per field), using `FormFieldRevision` / instance data.
9. "My protocols" list for proponents with status, code, version, last activity.
10. Fee: proponent uploads receipt; REC Staff page lists PENDING receipts with Verify / Reject (reason). Audited.

## Acceptance criteria
- Three proponents and an adviser on one protocol; two proponents edit different fields of the M04 test form at the same time without losing data; same field → conflict UI.
- Non-leader cannot submit; pending (unapproved) leader cannot submit.
- After submit, forms are read-only and the version snapshot is immutable (attempted write → error + test).
- Invite to a not-yet-registered email binds after sign-up.
- Every action above appears in the protocol `<AuditTimeline>`.

## Do not
- Implement review steps, reviewer assignment or decisions (M07/M08). Reviewer member roles exist in the table but are assigned by workflow later.
