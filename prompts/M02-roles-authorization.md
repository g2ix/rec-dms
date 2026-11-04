# M02 — Roles, memberships, authorization, role switcher

Read first: `docs/SPEC.md` → "Users, roles and accounts" (Roles, Role switching), "Security and data privacy" (Access).

## Goal
One user can hold many roles (global, per panel, per protocol), switch views without signing out, and every server action is authorized in one place.

## Data model
- `Role`: id, key (unique, e.g. `PROPONENT`, `PROJECT_LEADER`, `ADVISER`, `REC_STAFF`, `REC_CHAIR`, `PANEL_CHAIR`, `PRIMARY_REVIEWER`, `INDEPENDENT_CONSULTANT`, `REC_MEMBER`, `MEMBER_SECRETARY`, `SYSTEM_ADMIN`), name, scope enum `GLOBAL | PANEL | PROTOCOL`, description, isSystem (cannot delete).
- `Permission`: key (e.g. `users.approve`, `protocol.view`, `protocol.submit`, `workflow.edit`, `forms.edit`, `settings.edit`, `audit.view`), description.
- `RolePermission`: roleId, permissionKey.
- `UserRole`: userId, roleId, panelId (nullable; required when role scope is PANEL), grantedById, grantedAt, revokedAt.
- `Panel`: id, code (`P1`…), name, disciplines String[], active.
- Protocol memberships come in M05; design `authorize()` so it can read them (interface `ProtocolMembershipReader` with a stub now).

## Tasks
1. Seed system roles, permissions and the 3 panels (names and disciplines from SPEC "Review panels"). Role → permission mapping in a seed file, editable later in the admin UI.
2. `src/server/authz/index.ts`:
   - `authorize(user, action, resource?)` → throws `AppError('FORBIDDEN')`.
   - Resolves global roles, panel roles (when resource has `panelId`), protocol roles (via the membership reader).
   - Conflict-of-interest rule: a user who is PROPONENT or ADVISER on a protocol can never act as reviewer/chair on that protocol, even if they hold the role globally.
   - Pure policy functions per resource in `src/server/authz/policies/*.ts`, unit-tested.
3. Replace the bootstrap admin check from M01 with `authorize(user, 'users.approve')`.
4. Role switcher:
   - `getUserRoleViews(userId)` returns distinct role views the user can switch to (e.g. "Proponent", "Reviewer", "Panel Chair — Panel 2", "REC Staff").
   - Top-bar dropdown; selection stored in a cookie (`activeView`), default = the first available.
   - Navigation and dashboard read the active view; server actions ignore it and check real roles.
   - An "All my tasks" entry is always present (inbox filled in M07).
5. Admin UI `/admin/users`: search users, view their emails and linked methods, grant/revoke roles (with panel picker for PANEL scope), suspend/reactivate, approve pending.
6. Admin UI `/admin/roles`: list roles, edit permissions of non-system roles, create custom roles.
7. Middleware: protect `/admin/**`, `/app/**`; public: `/`, `/sign-in`, `/sign-up`, `/verify/**`.

## Acceptance criteria
- A user granted PANEL_CHAIR for Panel 2 and REC_MEMBER sees both views in the switcher and switches without reloading the session.
- Authorization ignores the cookie: changing `activeView` manually does not grant access.
- COI rule test: proponent on protocol X cannot be authorized as reviewer of X.
- Policy unit tests cover every permission × scope combination you define.

## Do not
- Hard-code panel names in code outside the seed.
