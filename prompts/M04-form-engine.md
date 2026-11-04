# M04 — Form engine

Read first: `docs/SPEC.md` → "Dynamic forms and exact-layout printing" (Form definition), "Current USC REC process" (Forms and who fills what). Skim `docs/forms/Updated_USC_REC_Forms.pdf` for field shapes, but do NOT seed the REC forms yet (M08).

## Goal
Forms are data. An admin defines a form's schema in JSON (with a builder + live preview); the app renders, validates and saves it, and knows who may fill which field at which step.

## Schema format (`src/lib/forms/schema.ts`, Zod)
```ts
FormSchema = {
  sections: Section[]
}
Section = { id, title, description?, fields: Field[], visibleIf?: JsonLogic }
Field = {
  id,                // stable key, e.g. "coi_declaration"
  label, help?,
  type: 'text'|'textarea'|'richtext'|'number'|'money'|'date'|'email'|'phone'
      | 'select'|'radio'|'checkboxes'|'yesNoNa'|'declaration'   // declaration = tick box with long legal text
      | 'repeatingTable'      // rows added by user (budget lines, researcher roster)
      | 'assessmentTable'     // fixed rows (assessment points 1.01…) × columns filled by different roles
      | 'signature' | 'fileRef' | 'computed' | 'staticText',
  options?: {value,label}[],
  bind?: string,              // shared protocol field path, e.g. "protocol.title", "protocol.researchers"
  fillers: RoleKey[],         // who may edit, e.g. ['PROPONENT']
  editableInSteps?: string[], // workflow step keys; empty = whenever the form is editable
  validation?: { required?, requiredIf?: JsonLogic, min?, max?, pattern?, naAllowedWithReason? },
  columns?: Column[],         // for repeatingTable / assessmentTable
  rows?: {id, code, label, help?}[],   // for assessmentTable
  formula?: string            // for computed, e.g. "sum(budget.*.total)"
}
Column = { id, label, type, fillers: RoleKey[], options?, editableInSteps? }
```
Use `json-logic-js` for conditions. Write the schema type once and infer TS types from Zod.

## Data model
- `FormDefinition`: id, code (`F-27`), title, version (`09-00`), effectiveDate, status `DRAFT | PUBLISHED | RETIRED`, schema Json, templateFileId (nullable; used in M10), placeholderMap Json (nullable), createdById, publishedAt. Unique (code, version).
- `FormInstance`: id, formDefinitionId, ownerType (`PROTOCOL_VERSION | SANDBOX`), ownerId, filledByMemberId (nullable; for per-reviewer forms), data Json, status `DRAFT | COMPLETE | LOCKED`, revision Int (optimistic lock), timestamps.
- `FormFieldRevision`: formInstanceId, fieldPath, value Json, userId, revision, at — one row per field save (feeds diff + audit).

## Tasks
1. Zod schema + a `validateSchema()` that also checks: unique ids, binds point to known shared paths (registry in `src/lib/forms/bindings.ts`, initially: protocol.code, title, versionLabel, researchers[], contactNumbers, emails, institution, institutionAddress, submissionDate), assessmentTable has rows + columns.
2. Runtime:
   - `getEditableFields(def, instance, user, roles, currentStepKey)` → set of editable field paths.
   - `saveField(instanceId, path, value, expectedRevision)` server action: authorize, check field editable, validate that field, write `FormFieldRevision`, bump revision, audit `form.field_saved` with diff. On revision mismatch return `CONFLICT` with the current value and who changed it.
   - `validateInstance(def, data)` → list of errors (for "Mark complete" and later submit gating).
   - Computed fields recalculated server-side on save.
3. Renderer `<FormRenderer definition instance mode="edit|view|print" />`:
   - Sections as cards; read-only fields visibly read-only; bound fields show the shared value with a lock icon and "Edit in protocol details" link.
   - `repeatingTable` with add/remove/reorder rows. `assessmentTable` renders like the REC form: rows of assessment points, columns per role; non-editable columns greyed.
   - `yesNoNa` with optional reason when NA (Capsule Proposal rule "indicate NA and explain why").
   - Autosave per field (debounced 800 ms) with saving / saved / conflict states.
4. Admin builder `/admin/forms`:
   - List definitions; create new version from an existing one (copy schema); publish (locks schema); retire.
   - Editor: JSON editor (Monaco) on the left with schema validation errors inline, live preview on the right with a role/step simulator ("preview as PROPONENT at step X"). A visual drag-and-drop builder is NOT required in phase 1.
5. Sandbox: `/admin/forms/[id]/try` creates a SANDBOX instance to test filling.

## Acceptance criteria
- An admin creates a small test form (text, yesNoNa with NA reason, repeatingTable, assessmentTable with a PROPONENT column and a REVIEWER column, a computed total), publishes it, fills it in the sandbox.
- As PROPONENT, the reviewer column is read-only; as PRIMARY_REVIEWER the proponent column is read-only.
- Two browser sessions editing the same field: the second save gets a conflict notice showing the other value.
- Published definitions cannot be edited, only versioned.
- Unit tests: schema validation, editable-fields resolution, computed formula, requiredIf, conflict detection.

## Do not
- Seed the USC REC forms (M08). Build DOCX printing (M10).
