# M06 — Digital signatures (phase 1: image + identity + hash)

Read first: `docs/SPEC.md` → "Signatures, audit trail and notifications" (Digital signature).

## Goal
A user signs a form with their stored signature image, after re-confirming identity; the signature is bound to the exact form data and voids if the data changes.

## Data model
- `Signature`: id, userId, version Int, fileId (PNG in storage), method `DRAWN | UPLOADED`, active Boolean, createdAt. One active per user.
- `SignatureEvent`: id, formInstanceId, fieldPath (the `signature` field in the schema, e.g. `signatures.researchers[2]` or `adviser_signature`), userId, signatureId, dataHash, protocolVersionId, signedAt, ip, userAgent, voidedAt, voidReason, verifyRef (short unique code, e.g. 10 chars base32).

## Tasks
1. Profile → "My signature":
   - Draw on a pad (`signature_pad`), or upload PNG/JPG. Trim whitespace, convert to transparent PNG (use `sharp`: threshold white to transparent), max 600×200.
   - Saving creates a new version and deactivates the previous one. Old versions remain for past signatures.
2. Step-up confirmation (`src/server/stepup.ts`):
   - Password users: re-enter password.
   - OAuth/magic-link users: 6-digit code emailed to contact email (reuse `EmailCode` purpose `STEP_UP`).
   - A successful step-up is valid for 10 minutes for signing only.
3. Signing service `signField(formInstanceId, fieldPath)`:
   - Authorize: the field's `fillers` + the signer must be the specific person the field targets (e.g. a researcher row → that member; adviser field → the ADVISER member).
   - Require an active signature image and a fresh step-up.
   - `dataHash = sha256(canonicalJSON(instance.data without signature fields))`.
   - Create `SignatureEvent`, audit `form.signed`.
4. Voiding: when `saveField` changes any non-signature field of an instance that has non-voided signatures, void them (`voidReason: 'DATA_CHANGED'`), audit `form.signature_voided`, and notify signers (in-app stub until M09). Forms show "Signature void — re-sign required".
5. Form rendering: `signature` field shows the image, signer name, date/time in Asia/Manila, and `verifyRef`. Unsigned shows a "Sign" button for the right person, or "Waiting for Juan D. Cruz" for others.
6. "Needs signatures" status in the Forms tab; submit gating (from M05) now also requires all required signature fields signed and not void. Default required signatures for testing: all proponents + adviser where the schema says so.
7. Public verify page `/verify/[ref]`: shows form code, protocol code (if assigned), signer name, signed time, and whether the stored hash still matches current data. No other protocol content (privacy).

## Acceptance criteria
- A proponent signs; another proponent then edits a field → the first signature becomes void and is flagged.
- Signing without step-up is refused; step-up older than 10 minutes is refused.
- The verify page reports "valid" for an intact signature and "no longer matches" after a change.
- Unit tests: hash canonicalization (key order independent), voiding, signer targeting.

## Later (do not build now)
- PNPKI certificate signatures on generated PDFs — keep `SignatureEvent` generic (add a `method` column now: `IMAGE` default).
