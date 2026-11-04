# M00 — Project setup

Read first: `docs/SPEC.md` → "Overview", "Architecture and tech stack". Follow `.cursor/rules/rec-dms.mdc`.

## Goal
An empty but production-shaped Next.js project with local infrastructure in Docker, ready for the next milestones.

## Tasks
1. Scaffold Next.js 15 (App Router, TypeScript strict, `src/` dir, ESLint) with pnpm. Add Tailwind and shadcn/ui (init + `button`, `input`, `label`, `card`, `dialog`, `dropdown-menu`, `table`, `toast`/`sonner`, `form`, `select`, `checkbox`, `textarea`, `badge`, `tabs`).
2. Create the folder layout from the rules file (`src/app`, `src/server`, `src/lib`, `src/components`). Add `src/server/db.ts` (Prisma singleton safe for dev hot reload).
3. Prisma: init with PostgreSQL. Add only a `Setting` model (`key` string PK, `value` Json, timestamps) for now. Create the first migration.
4. `docker-compose.yml` for local dev:
   - `postgres:16` (db `recdms`, volume)
   - `minio/minio` + bucket bootstrap (`recdms-files`)
   - `gotenberg/gotenberg:8` (map container port 3000 to host 3001, since Next.js uses 3000)
   - `axllent/mailpit` (SMTP 1025, UI 8025)
5. `src/lib/env.ts`: Zod-validated env (`DATABASE_URL`, `DIRECT_URL`, `AUTH_SECRET`, `AUTH_URL`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_REGION`, `GOTENBERG_URL`, `GOTENBERG_SECRET`, `SMTP_URL`, `EMAIL_FROM`, `APP_TIMEZONE=Asia/Manila`). Provide `.env.example`.
6. Helpers stubs (implemented later, just typed signatures + TODO):
   - `src/server/errors.ts` — `AppError` with `code`, `status`, `message`
   - `src/server/storage.ts` — `putObject`, `getSignedDownloadUrl`, `deleteObject` (implement now against MinIO)
7. Scripts in `package.json`: `dev`, `build`, `start`, `lint`, `typecheck` (`tsc --noEmit`), `test` (vitest run), `test:e2e` (playwright), `db:migrate`, `db:seed`, `db:studio`.
8. Vitest config with a separate test database (`DATABASE_URL` from `.env.test`) and a helper that resets the DB between test files.
9. Playwright config with one smoke test: home page loads.
10. A minimal home page that explains the system in two sentences. Do not style it beyond defaults: the design tokens, theme and sidebar shell come in M00b.
11. GitHub Actions CI: install, lint, typecheck, unit tests with a Postgres service.
12. Create `docs/CHANGELOG.md`.

## Acceptance criteria
- `docker compose up -d` then `pnpm db:migrate` then `pnpm dev` shows the home page at localhost:3000.
- `pnpm lint && pnpm typecheck && pnpm test` pass; Playwright smoke test passes.
- A unit test proves `storage.putObject` + `getSignedDownloadUrl` round-trip against MinIO.
- A unit test proves `env.ts` fails fast on a missing variable.

## Manual check
- MinIO console shows the bucket; Mailpit UI opens at :8025; Gotenberg health responds at localhost:3001/health.

## Do not
- Add auth, roles or business tables yet.
