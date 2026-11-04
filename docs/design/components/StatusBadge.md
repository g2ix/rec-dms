# Status badge

Shows a protocol's or task's status with color, icon and word.

- Map statuses with the table in the brand book (Color → Status mapping). Never color alone.
- Status text comes from the workflow step's `statusLabel`, so REC can rename statuses; the tone (draft, info, warning, success, danger) comes from the step's configured tone.
- Height 24px, `radius-sm`, `label` text. When a status changes on screen, crossfade the badge over `dur-base`.
- Due dates are not badges: show them as text in `warning` (due within 2 working days) or `danger` (overdue) with the date.

Consumer provides: tone, label.
