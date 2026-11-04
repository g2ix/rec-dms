# M10 — Document generation: exact-layout DOCX, PDF and print

Read first: `docs/SPEC.md` → "Dynamic forms and exact-layout printing" (Printing, Bundle export), "Signatures, audit trail and notifications" (Digital signature, printed footer).

Prerequisite: the original USC REC .docx files in `docs/forms/source/` (one per form). If missing, stop and ask.

## Goal
Every form prints in the official USC REC layout — DOCX identical to the source template, PDF converted from it, browser print from the PDF — filled with system data and signatures.

## Tasks
1. Template preparation (one-time, by developer, documented in `docs/TEMPLATES.md`):
   - Copy each source .docx to `templates/F-xx.docx` and insert docxtemplater tags without touching headers, fonts, table borders or page setup. Conventions:
     - Scalars `{protocol.title}`, `{protocol.code}`, `{protocol.versionLabel}`.
     - Loops `{#researchers}{displayName}, {/researchers}`; table row loops for budget lines, researcher rows, assessment points.
     - Checkboxes: `{cb_initial}` renders ☑ or ☐ (helper computes from data).
     - Images: `{%sig_leader}`, `{%sig_adviser}`, per-row `{%sig}` inside loops.
     - Footer for signed forms: `{signedFooter}` ("Signed electronically by … ref …").
   - A script `pnpm templates:check` lists every tag in each template and every field in the form schema, and reports unmapped ones both ways.
2. Upload templates through the admin form editor (store as `File` kind TEMPLATE, link `templateFileId`), with `placeholderMap` (template tag → data path or helper) editable as JSON with validation against `templates:check` output.
3. Renderer `src/server/docs/render.ts`:
   - `renderDocx(formInstanceId)` → Buffer: build the view model from instance data + bound shared fields + signature events (fetch images from storage, scale to the box size set in the map), run docxtemplater (+ image module; paragraphLoop, linebreaks on).
   - `renderPdf(formInstanceId)` → POST the DOCX to Gotenberg `/forms/libreoffice/convert` with `GOTENBERG_SECRET` header (configure Gotenberg basic auth or put it behind the tunnel with a shared secret); timeout 30 s; retry once.
   - Ensure fonts: document in DEPLOY.md that the Gotenberg image must have Times New Roman (msttcorefonts) installed — build a small custom image `docker/gotenberg/Dockerfile` FROM gotenberg/gotenberg:8 that installs `ttf-mscorefonts-installer` and the fonts used by the templates.
   - Cache: store generated files as `File` (GENERATED_DOCX / GENERATED_PDF) with sha256 and the instance revision; return the stored file if the revision is unchanged. Locked (submitted) versions render once and keep that file.
4. UI on each form: "Download DOCX", "Download PDF", "Print" (opens the PDF in a new tab for the browser print dialog). Audited.
5. Package export for a protocol version: one merged PDF in the REC order (F-26, cover letter, F-27, F-28, F-29, F-35, F-36, F-30, manuscript) using `pdf-lib`, plus a ZIP of individual files using the official REC file names (setting `docs.fileNamePattern` per form).
6. AUTO action `GENERATE_DOCUMENTS` (from M07): generate F-39 and (when approved) attach the Certificate of Approval if its template exists; otherwise skip with a warning in the task.
7. Visual regression check: script renders each template with fixture data to PDF and rasterizes page 1 to PNG (`pdftoppm` in CI), compared to a stored baseline with a pixel-diff threshold.

## Acceptance criteria
- For each of the 12 forms, the generated DOCX opened in Word shows the same header, tables and pagination as the source file, with data in place.
- PDF output keeps Times New Roman 12 and the REC header block.
- Signature images appear in the right cells; the footer reference resolves on `/verify/[ref]`.
- `templates:check` reports zero unmapped tags for all published forms.
- The package ZIP uses the official file names unchanged.

## Do not
- Generate layout from HTML. The .docx template is the single source of layout.
