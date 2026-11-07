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

The Certificate of Approval is not in the set. When a release is Approved and `templates/COA.docx` is missing, the release task gets a warning and the letter is still generated.

## Known tag choices

- F-27 research-type boxes on the paper are more specific than the form. Clinical maps to the sponsored clinical box, social to the social box, and other to the others box.
- F-27 declarations follow the six declaration fields in form order.
- F-27 shows the project leader's signature on the signature line. Every signer is still named in the footer.
- F-29 has more narrative boxes than fields. The later method fields share the last ethics box.
- F-36 prints the REC Chair's name on the consent contact line. The source file still says Panel Chair.
- F-30 leftover budget rows fill the remaining named lines, then one details list per section. The ethics review fee is added into MOOE and the grand total.

## PDF conversion

`PDF_CONVERTER=libreoffice-local` (the older name `soffice` still works) uses local LibreOffice (`soffice --headless`). `PDF_CONVERTER=gotenberg` posts the docx to `$GOTENBERG_URL/forms/libreoffice/convert` with basic auth from `GOTENBERG_USERNAME` and `GOTENBERG_PASSWORD`. The request times out after 90 seconds and is tried twice more on a 5xx or a timeout. On Vercel that work is a background job so a cold start does not hold the page.

On the USC server, build the Gotenberg image in `docker/gotenberg`. It installs Times New Roman. See `docs/DEPLOY.md`.

## File names

`docs.fileNamePattern` is a setting. The default uses the official file name, with the extension swapped for PDF. A protocol package is one merged PDF in the order F-26, cover letter, F-27, F-28, F-29, F-35, F-36, F-30, manuscript, and a ZIP of those files. A second copy of the same form gets ` (2)` so the names do not collide.

A locked form is generated once and reused. A form still being edited is generated again when its revision changes.
