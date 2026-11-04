# Fix request

Follow `.cursor/rules/rec-dms.mdc`. Context: `docs/SPEC.md`, `docs/CHANGELOG.md`.

**Milestone where it appeared:** Mxx

**What I did:**
<steps to reproduce, user/role, page>

**What happened:**
<error message, screenshot description, logs>

**What I expected:**
<expected behavior; quote the acceptance criterion from the milestone prompt if relevant>

Instructions:
1. Find the root cause before changing code; explain it in 2–3 sentences.
2. Write a failing test that reproduces it.
3. Fix with the smallest change; do not refactor unrelated code.
4. Run `pnpm lint && pnpm typecheck && pnpm test`.
5. Add a line to `docs/CHANGELOG.md` under "Fixes".
