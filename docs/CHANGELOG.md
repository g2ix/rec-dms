# Changelog

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
