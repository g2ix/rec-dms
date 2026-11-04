# Button

Buttons trigger one action named in their label.

- Variants: `primary` (one per view, the main action), `secondary` (other actions), `ghost` (cancel, low emphasis, toolbar), `danger` (destructive or returning work: "Return to proponent", "Remove member").
- Height `control-height` (40px; 44px on touch). Radius `radius-sm`. Icon optional, 18px, before the label.
- Label in sentence case, verb first: "Sign F-27", "Release decision".
- Motion: hover color over `dur-fast`; press scale 0.97 over `dur-instant`; release with `ease-spring` over `dur-base`.
- In progress: set `aria-busy="true"`, keep the width, change the label to the -ing form ("Submitting…"), and show the bottom sweep. Never replace the label with a spinner.
- Disabled buttons explain why nearby ("Waiting for 2 signatures") instead of a tooltip only.

Consumer provides: label, optional icon, variant, `onClick`, busy state.
