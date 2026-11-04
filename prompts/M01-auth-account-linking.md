# M01 — Authentication and account linking

Read first: `docs/SPEC.md` → "Users, roles and accounts" (Account linking, Registration), "Security and data privacy".

## Goal
People sign in with Google, email + password, or an email magic link, and can link several identities and emails to ONE account. Non-USC accounts wait for approval.

## Data model (Prisma)
- `User`: id, firstName, middleInitial, familyName, displayName (computed "First M. Family"), status enum `ACTIVE | PENDING_APPROVAL | SUSPENDED`, passwordHash (nullable, argon2id), primaryEmailId, approvedById, approvedAt, timestamps.
- `Account`, `Session`, `VerificationToken` per @auth/prisma-adapter.
- `UserEmail`: id, userId, email (unique, lowercase), verifiedAt, isContact (exactly one true per user), isPrimary.
- `EmailCode`: id, email, purpose (`VERIFY_EMAIL | LINK_EMAIL | STEP_UP`), codeHash, expiresAt, attempts, userId?.

## Tasks
1. Auth.js v5 config in `src/server/auth.ts`:
   - Providers: Google, Credentials (email + password), Nodemailer magic link (SMTP from env).
   - Session strategy `jwt` (needed for Credentials), JWT holds only `userId`; load the user from DB per request in `requireUser()`.
   - Custom adapter wrapper: `getUserByEmail` looks up **any verified `UserEmail`**, not only `User.email`, so a magic link or Google login with any linked, verified email reaches the same account.
   - Keep `allowDangerousEmailAccountLinking` **off**. Linking only happens through the explicit flows below.
2. Sign-up page: name parts (first, MI, family — REC format "Juan D. Cruz"), email, password (min 12 chars, zxcvbn score ≥ 3). Send a 6-digit verification code by email; account usable after verification.
3. Registration rule: verified email ending with a configurable domain list (setting `auth.autoApproveDomains`, default `["usc.edu.ph"]`) → `ACTIVE`; otherwise `PENDING_APPROVAL`.
   - Pending users can sign in, see a banner "Your account is waiting for REC Staff approval", and later draft protocols, but `requireActiveUser()` blocks submit actions.
4. Profile → "Sign-in methods" page:
   - List linked providers and emails.
   - "Link Google account": calls `signIn('google')` while signed in; the callback attaches the new `Account` to the current user. If that Google account already belongs to another user, refuse with a clear message (no merge in phase 1).
   - "Add email": send code, verify, then it becomes a login email and can be set as contact email.
   - "Set password" for OAuth-only users.
   - Remove a method, but never the last one.
5. `requireUser()` and `requireActiveUser()` helpers in `src/server/session.ts`.
6. Rate limiting (simple DB- or memory-backed limiter, swappable later): sign-in 10/min/IP, code sends 5/hour/email, code attempts max 5.
7. Admin stub page `/admin/users/pending` listing pending users with Approve / Reject buttons (authorization will be enforced in M02; for now restrict to users in env `BOOTSTRAP_ADMIN_EMAILS`).
8. Seed script creates one admin from `BOOTSTRAP_ADMIN_EMAILS`.

## Acceptance criteria
- Same person signs in with Google (usc.edu.ph), links a personal Gmail and a Yahoo email, and reaches the same account through all three.
- A Gmail-only sign-up lands in `PENDING_APPROVAL`; a usc.edu.ph sign-up is `ACTIVE`.
- Attempting to link a Google account owned by someone else is refused.
- The last sign-in method cannot be removed.
- Tests: adapter `getUserByEmail` resolution, approval rule, code expiry/attempt limits, last-method guard.

## Manual check
- Use Mailpit to read codes and magic links. Try each sign-in method in an incognito window.

## Do not
- Implement roles beyond the bootstrap admin check (M02).
- Write audit events yet (M03 will add them to these actions — leave `// AUDIT:` comments where they go).
