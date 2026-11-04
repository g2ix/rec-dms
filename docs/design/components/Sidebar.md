# Sidebar

The vertical navigation that frames every signed-in page.

- Order top to bottom: seal + "REC-DMS", role switcher, nav groups for the active role, then collapse control and user menu at the bottom.
- Width `sidebar-width`; collapses to `sidebar-rail` (icons only, tooltips) over `dur-slow` with `ease-out-soft`. Labels fade, icons stay put. The choice is remembered.
- Active item: `primary-soft` fill, `primary-ink` text, and a 3px `primary` marker that slides between items with `ease-spring`.
- Counts (open tasks) sit at the right in `ink-muted`; overdue counts use `danger`.
- Below 1024px it becomes a left drawer over `scrim`, opened from the top bar; swipe or Escape closes it.
- Role switcher: lists every role view the user holds ("Proponent", "Reviewer", "Panel Chair — Panel 2", "REC Staff"); switching changes the nav and dashboard with a content fade, never a full reload.

Nav per role (phase 1):
- Proponent: Dashboard, My tasks, My protocols, New protocol.
- Adviser: Dashboard, My tasks, Advised protocols.
- Reviewer / IC: Dashboard, My reviews.
- Panel Chair: Dashboard, Decisions, Panel protocols, Reviewers.
- REC Staff: Dashboard, Screening queue, Fee receipts, Releases, All protocols, Users, Reports.
- REC Chair / Admin: adds Workflows, Forms, Settings, Audit log.

Consumer provides: nav items for the active role, current path, counts, collapsed state.
