# USC REC-DMS brand book

Source of truth: the USC REC-DMS Design System artifact. Tokens: tokens.json / tokens.css in this folder. Reference CSS for every component: reference-components.css. Per-component rules: components/*.md.

The interface of the USC Research Ethics Committee's protocol review system. It should feel like a well-run university office: calm, exact, and quick, never flashy. People use it to submit research for ethics review, review it, and decide on it. Most proponents are students on phones; reviewers and REC Staff work on laptops for long sessions.

## Content fundamentals

- Use the REC's own wording for anything that appears on a form: "Researcher(s)/Proponent(s)", "Protocol Review Assessment Form", "Minor Modifications Required". Never paraphrase an assessment point.
- Address the user as "you"; the system speaks as "we" only in REC notices ("We received your submission").
- Sentence case for buttons, labels and headings ("Submit for review", not "Submit For Review"). Form codes stay as written: `F-35`, `USC REC F-27`.
- Buttons say what happens: "Sign F-27", "Return to proponent", "Release decision". Never "OK", "Proceed", "Click here".
- Names follow REC format: "Juan D. Cruz" (first, middle initial, family).
- Dates: "4 Nov 2026" in tables, "Wednesday, 4 November 2026, 2:32 PM" in signatures and audit entries, always Philippine time. Relative times ("2 days left") only next to an absolute date.
- No emoji, no exclamation marks, no "Oops". Errors say what went wrong and what to do: "This field needs the page and paragraph number, or NA with a reason."

## Logo

- Use the USC seal (`public/brand/usc-seal.png` (512px copy: `usc-seal-512.png`), transparent background) as provided: never recolor, outline, crop, add effects, or place it on a busy image.
- Sidebar: seal at 32px beside "REC-DMS" set in `subheading`; collapsed rail shows the seal alone at 32px.
- Sign-in page: seal at 96px above the `display` title "Research Ethics Committee".
- Minimum size 24px. Keep clear space of half its height around it.
- The seal works on `bg`, `surface` and `surface-sunken` in both themes. Do not set it on `primary` or any brand fill.

## Color

- The page is mostly neutral. Lay out on `bg`, put content on `surface` with a `border` hairline, use `surface-sunken` for the sidebar, table headers and locked fields.
- `primary` (USC green) is the one action color: primary buttons, links, the active nav marker, checked toggles, success. One primary button per view.
- Logo colors (`brand-green`, `brand-red`, `brand-blue`, `brand-gold`) are for decoration only, because none of them reach 4.5:1 for text. For meaning, use `primary`, `danger`, `info`, `warning`, which are the same hues deepened.
- `brand-gold` appears at most once per screen, small.
- Status colors always come with a word and an icon. Never signal a state with color alone.
- Text: `ink` on all grounds; `ink-muted` for secondary text. Text on a soft fill uses its `-ink` token (`primary-ink` on `primary-soft`).
- Focus: every focusable element gets a 2px solid `focus` ring with 2px offset. Never remove outlines without this replacement.

### Status mapping

| Protocol status | Badge fill / text | Icon |
|---|---|---|
| Draft | `surface-sunken` / `ink-muted` | pencil |
| Submitted, Under screening, Under review | `info-soft` / `info-ink` | clock |
| Returned (incomplete), Awaiting revision | `warning-soft` / `warning` | rotate-ccw |
| Approved, Exempted | `primary-soft` / `primary-ink` | check |
| Disapproved, Lapsed, Withdrawn | `danger-soft` / `danger-ink` | x |

## Typography

- Interface text is Public Sans (`sans`). Page titles use Source Serif 4 (`serif`) to echo the printed REC forms; nothing else is serif.
- Codes and versions use JetBrains Mono (`mono`) via `code`: `USC-REC-2026-0123`, `F-35`, `2/28May2022`.
- One `title` per page. Section headings `heading`; field labels `label`; body copy `body` (15px). Tables use `body-sm`.
- Never below 12px (`caption`). Never all caps except form codes.
- Load fonts from Google Fonts with `display=swap`: Public Sans 400, 500, 600; Source Serif 4 600; JetBrains Mono 500.

## Layout and navigation

- **Vertical navigation first.** A left sidebar (`sidebar-width`, on `surface-sunken`) holds: the seal and app name, the role switcher, the nav groups for the current role, and the user menu at the bottom.
- The sidebar collapses to an icon rail (`sidebar-rail`) with a toggle; the choice is remembered per user. Collapsing animates width over `dur-slow` with `ease-out-soft`; labels fade out in the first half and the icons stay fixed, so nothing jumps.
- The active item gets `primary-soft` fill, `primary-ink` text and a 3px `primary` marker on its left edge. The marker slides between items with `ease-spring`, it does not blink.
- Below 1024px the sidebar becomes a drawer from the left over `scrim`, opened from a menu button in the top bar. It slides in over `dur-slow` and can be swiped closed.
- Top bar (`topbar-height`, on `bg`): breadcrumb, global search (Staff and Chairs), notifications bell, theme switch.
- Content max width `content-max`; forms 760px, left-aligned, never centered in a wide void.
- Spacing comes only from the spacing tokens. Between form sections `space-6`; between fields `space-4`.
- Cards have a `border` hairline and `radius-md`, no shadow. Shadows (`shadow-pop`) are for things that float: menus, popovers, toasts, dialogs.

## Motion

Motion explains what changed. It is slow enough to see and never in the way.

- **Buttons:** hover shifts color over `dur-fast`. Press scales to 0.97 over `dur-instant`; release springs back over `dur-base` with `ease-spring`. Nothing else moves.
- **Toggles:** the thumb travels with `ease-spring` over `dur-base` and briefly stretches 4px wider mid-travel. The track color crossfades on the same timing.
- **Checkboxes:** the tick draws in (stroke-dashoffset) over `dur-fast`, with a 1.08 scale bounce on the box.
- **Tabs and segmented controls:** a sliding indicator moves under the selected item with `ease-spring`.
- **Menus and popovers:** fade plus 4px rise over `dur-base` with `ease-out-soft`, origin at the trigger.
- **Page content:** fades in and rises 8px over `dur-slow` on navigation. The sidebar and top bar never animate on navigation.
- **Lists:** new rows fade in; removed rows collapse their height over `dur-base`. No staggered cascades longer than 120ms in total.
- Honor `prefers-reduced-motion: reduce`. Springs and movement become plain 120ms opacity fades; blur reveals become instant.
- Implement springs with CSS using `ease-spring` where possible. Use Motion (framer-motion) only for layout animations: the nav marker, list reordering, the drawer gesture.

## Loading: blur, never spinners

- Do not use spinners anywhere.
- **First load:** render the real layout with placeholder content (gray text-shaped bars, empty table rows at real row height) behind a `blur-loading` filter. When data arrives, crossfade to the real content as the blur clears over `dur-reveal`. The layout does not shift.
- **Refresh** (filter, sort, page change, revalidation): keep the current content visible, apply `blur-stale` and opacity 0.7, block pointer events, and clear when the new data lands.
- **Buttons in progress:** keep the label and width. Dim the label to 0.7 and run a 2px progress sweep along the bottom edge of the button. Disable repeat clicks.
- **Autosave:** the field's caption shows "Saving…", then "Saved", then fades after 3 seconds. A conflict replaces it with a `warning` notice naming who changed the field.
- **Long jobs** (PDF generation, package export): show an inline progress row with a determinate bar if progress is known, otherwise a sweeping bar, plus text ("Preparing PDF of F-35…").
- In Next.js, `loading.tsx` and Suspense fallbacks render the blurred skeleton of that route, never a centered spinner.

## Theming

- Three choices in the theme switch: Light, Dark, System (default). System follows `prefers-color-scheme` and updates live.
- Store the choice in a cookie so the server renders the right theme with no flash. Set `data-theme` on `<html>` before paint.
- Switching themes crossfades colors over `dur-base` (except on first paint).
- Every token has a value in both themes. Check contrast in both before adding a color.
- Images and the seal need no dark variant. Uploaded PDFs and signature images always sit on a white plate (`#ffffff`) in dark mode so scanned documents stay readable.

## Forms

- Labels sit above fields, in `label`. Help text sits under the label in `ink-muted`, before the field.
- Required fields have no asterisk soup: mark optional fields "(optional)" instead, since most REC fields are required.
- Locked or bound fields (shared protocol details) render on `surface-sunken` with a lock icon and "Edit in protocol details".
- Errors appear under the field in `danger` with an icon, and the field border turns `danger`. Validate on blur and on submit, never on every keystroke.
- Assessment tables (F-35, F-36, F-38) keep the REC column order. Columns the current user cannot edit render on `surface-sunken` and say whose column it is ("Reviewer's assessment").
- On phones, assessment tables become stacked cards: one card per assessment point, columns as labeled rows.
- Signature fields show the signature image on a white plate, the signer's name, the time, and the verify reference in `code`.

## Iconography

- Lucide icons at 1.75px stroke, 18px in navigation and buttons, 16px inline. Icons are `ink-muted` unless they carry status color.
- An icon never stands alone without a visible label, except in the collapsed rail, where every icon has a tooltip.
- No illustrations or mascots. Empty states use one line of `heading`, one line of `body`, and one action.

## What we avoid

These make an interface look machine-made. Do not use them:

- Purple or blue-purple gradients, glassmorphism, glowing borders, neon accents.
- Emoji or sparkle icons as decoration; "AI" stars anywhere.
- Big rounded cards with drop shadows everywhere; cards with a colored left border.
- Centered hero sections inside the app; giant greeting banners ("Good morning, Juan!").
- Filler stat tiles with no decision behind them. Every number on a dashboard links to the list it counts.
- Lorem ipsum or invented sample data in production screens.
- Inter or Roboto as the default face.
- Spinners, skeleton shimmer gradients sweeping across the page, bouncing dots.
- Toasts for things that should be inline. Use toasts only for background results ("PDF ready").
