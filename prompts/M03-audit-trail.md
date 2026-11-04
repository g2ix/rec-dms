# M03 — Audit trail

Read first: `docs/SPEC.md` → "Signatures, audit trail and notifications" (Audit trail), "Data model" (`audit_events`).

## Goal
A tamper-evident, append-only record of every meaningful action, written in the same transaction as the change.

## Data model
`AuditEvent`: id (uuid), seq (bigint, autoincrement, unique), occurredAt, actorUserId (nullable for system), actingRole (string, nullable), action (string, e.g. `auth.sign_in`, `user.role_granted`, `protocol.submitted`), entityType, entityId, protocolId (nullable, indexed), diff Json (before/after for changed fields only), meta Json (ip, userAgent, extra), prevHash, hash.

## Tasks
1. `src/server/audit/index.ts`:
   - `audit.record(tx, event)` — inside the caller's transaction. Takes a Postgres advisory transaction lock (`pg_advisory_xact_lock`) so `seq` and the hash chain are strictly ordered.
   - `hash = sha256(prevHash + canonicalJSON(eventWithoutHash))`; first row uses `prevHash = 'GENESIS'`.
   - `diffOf(before, after)` helper returning only changed keys; redact secrets (`passwordHash`, codes, tokens).
   - Request context helper to capture IP and user agent from headers in Server Actions.
2. Database hardening migration (raw SQL in a Prisma migration):
   - Trigger that rejects UPDATE and DELETE on `audit_events`.
   - Document in `docs/DEPLOY.md` how to give the app DB role only INSERT/SELECT on this table in production.
3. `audit.verifyChain({ fromSeq?, toSeq? })` → first broken seq or ok. Expose as a script `pnpm audit:verify` and as an internal route for the cron in M09.
4. Wire audit into everything already built: sign-in, sign-out, failed sign-in, sign-up, email verified, identity linked/unlinked, password set, user approved/rejected/suspended, role granted/revoked, role permission changed, setting changed. Remove the `// AUDIT:` comments from M01.
5. UI:
   - `/admin/audit`: filter by actor, action, entity, protocol, date range; paginated table; CSV export (permission `audit.view`).
   - Reusable `<AuditTimeline protocolId>` component (used from M05 on) with a "simplified" mode that hides IP/user agent and internal-only actions for proponents.
   - Chain status badge on the admin page ("Chain verified up to #12,345 at 02:00").

## Acceptance criteria
- Updating or deleting an audit row via SQL fails.
- Manually altering a row's `diff` in a test DB (with the trigger disabled) makes `audit:verify` report that seq.
- An action that fails and rolls back leaves no audit row.
- 100 concurrent `audit.record` calls in a test produce a valid chain.

## Do not
- Log full file contents or passwords. Log file ids and hashes only.
