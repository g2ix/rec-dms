# Document templates

Official USC REC forms are printed from Word templates. The app fills tags in those files and converts the result to PDF. It does not draw the form from HTML.

## Where the files live

- `docs/forms/source/` holds the Word files the secretariat provided, plus the combined PDF.
- `templates/{code}.docx` is the tagged copy the app fills.
- `templates/maps/{code}.json` maps each tag to a form field.
- `pnpm templates:prepare` rebuilds the tagged copies from the source files.
- `pnpm templates:check` fails if a tag has no mapping or a form field is left off the template.
- `pnpm templates:visual` compares a rendered page with `templates/baselines/`. It exits without doing anything when LibreOffice or `pdftoppm` is not installed, and when no baseline has been saved.

## Official Word files

F-26, F-27, F-28, F-29, F-30, F-35, and F-36 are tagged inside the secretariat's files. Headers, the seal, fonts, borders, and page setup stay. `{signedFooter}` is added to the existing footer.

## Forms that exist only in the combined PDF

F-31, F-37, F-38, F-39, and F-41 have no separate Word file. They are pages in `docs/forms/source/Updated USC REC Forms.pdf`. Their templates are rebuilt from the F-26 header and Times New Roman tables transcribed from that PDF. Page breaks will not match the PDF.

The 2025 set has no Certificate of Approval. When a 2025 release is Approved and `templates/COA.docx` is missing, the release task gets a warning and the letter is still generated. The November 2026 set has F-40 (below).

## Known tag choices

- F-27 research-type boxes on the paper are more specific than the form. Clinical maps to the sponsored clinical box, social to the social box, and other to the others box.
- F-27 declarations follow the six declaration fields in form order.
- F-27 shows the project leader's signature on the signature line. Every signer is still named in the footer.
- F-29 has more narrative boxes than fields. The later method fields share the last ethics box.
- F-36 prints the REC Chair's name on the consent contact line. The source file still says Panel Chair.
- F-30 leftover budget rows fill the remaining named lines, then one details list per section. The ethics review fee is added into MOOE and the grand total.

## November 2026 set (M14)

The official Word files of the November 2026 process are in `docs/forms/source/` under their full names (`USC REC F-26 - Document Receipt Form.docx` … `USC REC F-42 - Certification of Exemption from Review.docx`). The short-named files there stay for the 2025 templates.

- `scripts/prepare-templates-2026-11.ts` tags them into `templates/2026-11/{code}.docx` and `templates/2026-11/maps/{code}.json`. Run it with `node --experimental-transform-types --import ./scripts/register-ts.mjs scripts/prepare-templates-2026-11.ts`, optionally followed by form codes.
- `pnpm db:seed` stores each template beside its 2026 form version (the same mechanism as replacing a template on the form screen), so a 2025 version keeps printing with its 2025 file. The seed needs object storage for this.
- `pnpm templates:check` checks both sets, each against its own form versions.
- F-31, F-37, F-38, F-39 and F-41 now print on the official files. The rebuilt 2025 templates stay for the 2025 versions.
- F-37 and F-38 print one loop row per point that has text, with points ticked **Needs revision** highlighted in yellow. The fixed point rows and the section headings of the Word file are replaced by that loop. The chair's overriding comment prints in place of the reviewers' words in the copy sent to the researcher.
- F-38 prints comments and recommendations together in the comments column; the recommendations column stays empty.
- F-41 prints the five types of research and the three data collection methods in the one row the Word file gives each group: their boxes and comments sit side by side.
- F-40 and F-42 are forms, so the chair and the researchers can sign them. The release date, the validity period, the progress report date and the continuing review date come from the `certificates.*` settings when the decision is released. The Conformé shows the first four researchers' signatures; every signer is listed in the footer.
- F-39 keeps the printed instructions for each decision and fills the submission deadline and, when disapproved, the justification.

## Intake set (11-01, INTAKE-01)

F-26, F-27, F-28, F-30, F-35, F-36 and F-38 version 11-01 print from the intake and the Details page. Their templates are in `templates/11-01/`, derived from the tagged 2026 set by `pnpm templates:prepare-11` (`scripts/prepare-templates-11-01.ts`). The layout of the Word files is unchanged; only placeholders move:

- F-27 and F-28: the signature row repeats for every researcher (`signers` helper), each with the date that researcher signed. The six declaration boxes print ticked when every researcher has agreed on the intake.
- F-30: "d. Ethics Review Fee" prints in the column the proponent chose (`fee_personal` … `fee_total`). Budget items are free text guided by the named lines: an item that matches a named line (salaries, honoraria, travel, supplies, incentive) prints there, every other item on the `<details>` lines. Extra MOOE items all print under "a. Traveling expenses", where the Word file has its first `<details>` line.
- F-35 and F-36: the 2026 templates, with the page and line filled from `intake.references` (`p. 3, line 12`, or `NA`).
- F-38: the Type of Review boxes from the review type, and every researcher's signature in the Researcher(s)/Proponent(s) cell.
- `pnpm templates:check` checks the 2025, 2026-11 and 11-01 sets.

## PDF conversion

`PDF_CONVERTER=libreoffice-local` (the older name `soffice` still works) uses local LibreOffice (`soffice --headless`). `PDF_CONVERTER=gotenberg` posts the docx to `$GOTENBERG_URL/forms/libreoffice/convert` with basic auth from `GOTENBERG_USERNAME` and `GOTENBERG_PASSWORD`. The request times out after 90 seconds and is tried twice more on a 5xx or a timeout. On Vercel that work is a background job so a cold start does not hold the page.

On the USC server, build the Gotenberg image in `docker/gotenberg`. It installs Times New Roman. See `docs/DEPLOY.md`.

## File names

`docs.fileNamePattern` is a setting. The default uses the official file name, with the extension swapped for PDF. A protocol package is one merged PDF in the order F-26, cover letter, F-27, F-28, F-29, F-35, F-36, F-30, manuscript, and a ZIP of those files. A second copy of the same form gets ` (2)` so the names do not collide.

A locked form is generated once and reused. A form still being edited is generated again when its revision changes.
