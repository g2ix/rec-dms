# Field

A labeled input with help, autosave state and error.

- Order: label (`label`), help (`ink-muted`), control, then autosave caption or error. Width up to 760px.
- Mark optional fields "(optional)"; required is the default.
- Bound shared fields (protocol title, researchers) are read-only on `surface-sunken` with a lock icon and a link to where they are edited.
- Autosave: debounce 800ms, caption "Saving…" → "Saved" → fades after 3s. On conflict, the caption turns `warning`: "Changed by Juana S. Santos a moment ago. Review" with both values.
- Errors: `danger` border and message under the field with an icon; validate on blur and on submit.
- "NA with reason": when the answer is NA, a reason field slides open below (`dur-base`, `ease-out-soft`).

Consumer provides: label, help, value, `onChange`, error, save state, read-only flag.
