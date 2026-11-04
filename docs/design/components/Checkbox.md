# Checkbox

A choice inside a form: declarations, multiple-choice items, checklist rows.

- 18px box, 4px radius, `border-control`; checked: `primary` fill, tick in `on-primary`.
- Motion: the tick draws in over `dur-fast`; the box bounces to 1.08 with `ease-spring`.
- REC declarations (F-27, F-28) use full sentences as labels, exactly as written on the form.
- Printed forms render checked items as ☑ and unchecked as ☐ (see the form templates), not this control.

Consumer provides: label, checked, `onChange`, name/value.
