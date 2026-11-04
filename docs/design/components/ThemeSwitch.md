# Theme switch

Lets a person choose Light, Dark or System (default).

- Segmented control with a sliding indicator (`ease-spring`, `dur-base`). Lives in the top bar on desktop and in the user menu on phones.
- System follows `prefers-color-scheme` and updates live when the device changes.
- Store the choice in a cookie and set `data-theme` on `<html>` on the server so there is no flash. Crossfade colors over `dur-base` when the person switches.
- Every color token has a value in both themes; never hard-code a color in a component.

Consumer provides: current choice, `onChange`. The app shell handles persistence.
