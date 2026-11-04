# Toggle

A switch for a setting that takes effect immediately.

- Use for settings and preferences ("Email me when a task is assigned"). Use a checkbox inside forms that are saved or submitted, and for REC declarations.
- Track 44×26px, `radius-pill`, `border-control` border; on: `primary` track, `on-primary` thumb.
- Motion: the thumb travels with `ease-spring` over `dur-base` and stretches 4px while pressed, so it feels springy. Colors crossfade on the same timing.
- The label sits to the right and is the click target too.
- Saving: if the setting saves to the server, show the autosave caption ("Saved") next to it; on failure, spring the thumb back and show the error inline.

Consumer provides: label, checked, `onChange`.
