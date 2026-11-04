# REC-DMS — Cursor build kit

Prompts to build the USC REC Document Management System with an AI coding agent in Cursor, one milestone at a time.

## Setup (once)

1. Create an empty folder for the project and open it in Cursor.
2. Copy into it:
   - `.cursor/rules/rec-dms.mdc` and `.cursor/rules/ui-design.mdc` (project and UI rules, applied to every chat automatically)
   - `prompts/` (this folder)
   - `docs/design/` (brand book, tokens, reference component CSS and per-component rules, from the USC REC-DMS Design System)
   - `public/brand/` (the official USC seal, transparent, plus favicon and app icons made from it)
3. Export the design spec doc as Markdown (in the doc: Export → Markdown) and save it as `docs/SPEC.md`.
4. Put the official REC form files in `docs/forms/` when you have them:
   - `docs/forms/source/` — the original .docx files, unmodified
   - the PDFs you already have (`Updated_USC_REC_Forms.pdf`, guides, flowchart) — used as reference in M08

## Running a milestone

1. Start a **new** Cursor Agent chat per milestone (keeps context clean).
2. Paste the whole content of `prompts/Mxx-*.md`.
3. Let the agent plan first; check the plan against the "Acceptance criteria".
4. When done, run the checks yourself:
   ```
   pnpm lint && pnpm typecheck && pnpm test
   ```
   and walk through the "Manual check" list in the prompt.
5. Commit with the milestone name (e.g. `M03: audit trail`) before starting the next one.

If something breaks later, open a new chat and paste `prompts/FIX-template.md` with the error.

## Order

| # | Milestone | Depends on |
|---|---|---|
| M00 | Project setup | — |
| M00b | Design system and app shell (tokens, themes, motion, blur loading, sidebar) | M00 |
| M01 | Authentication and account linking | M00b |
| M02 | Roles, memberships, authorization, role switcher | M01 |
| M03 | Audit trail | M02 |
| M04 | Form engine | M03 |
| M05 | Protocols, collaboration, uploads, versions | M04 |
| M06 | Signatures | M05 |
| M07 | Workflow engine and builder | M06 |
| M08 | USC REC seed: forms, workflows, panels | M07 + REC answers to open decisions |
| M09 | Notifications and deadlines | M07 |
| M10 | Document generation (DOCX/PDF/print) | M08 + original .docx files |
| M11 | Dashboards and reports | M08, M09 |
| M12 | Hardening and deployment | all |

M09 can run before M08 if you are waiting on REC.

## Design references

- USC REC-DMS Design System (artifact): brand book, tokens, live component previews with motion. `docs/design/` is a copy for the agent.
- REC-DMS key screens (artifact): proponent dashboard, F-27 with co-proponents, phone F-35, reviewer F-35, loading state. Tell Cursor to match them when building those screens, and paste a screenshot into the chat when you do.
- If you change the design system, re-copy `tokens.css`, `tokens.json` and the component docs into `docs/design/`; the `tokens-check` script from M00b catches drift.
