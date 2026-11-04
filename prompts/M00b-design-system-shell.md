# M00b — Design system and app shell

Read first: `.cursor/rules/ui-design.mdc`, `docs/design/BRAND.md`, `docs/design/tokens.json`, `docs/design/reference-components.css`,
`docs/design/components/*.md`. Run right after M00, before M01, so every later screen uses these pieces.

## Goal
The USC REC-DMS look, motion, loading and theming exist as reusable code, and every signed-in page sits inside the sidebar shell.

## Tasks
1. Tokens:
   - Copy `docs/design/tokens.css` to `src/styles/tokens.css`; import it in `globals.css` before Tailwind layers.
   - Write `scripts/tokens-check.ts` that fails CI if `src/styles/tokens.css` drifts from `docs/design/tokens.json`
     (same names and values, both themes).
   - Tailwind config: colors, spacing, radius, boxShadow, transitionDuration, transitionTimingFunction, blur, fontFamily,
     and the type styles as utilities, all pointing at the CSS variables. Remove Tailwind's default palette so stray
     `bg-blue-500` classes fail lint (`eslint-plugin-tailwindcss` with `no-custom-classname` off, `no-arbitrary-value` on).
   - Re-point shadcn/ui CSS variables (`--background`, `--foreground`, `--primary`, `--ring`, …) to the tokens.
2. Fonts with `next/font/google`: Public Sans, Source Serif 4, JetBrains Mono → `--font-sans`, `--font-serif`, `--font-mono`.
3. Brand: copy `public/brand/*` from the kit; favicon, apple-touch-icon and manifest icons in `app/layout.tsx` metadata.
   `<Seal size={32|96} />` component using `public/brand/usc-seal-512.png` with alt "University of San Carlos seal".
4. Theme:
   - `ThemeProvider` + `ThemeSwitch` (segmented Light/Dark/System, sliding indicator with `ease-spring`).
   - Cookie `theme` (`light|dark|system`, default `system`); root layout reads it and renders `data-theme`.
     For `system`, an inline `<script>` in `<head>` resolves `prefers-color-scheme` before paint and updates on change.
   - Crossfade on switch (add a `theme-fade` class for `dur-base`), never on first paint. No flash in either theme (test it).
5. Primitives in `src/components/ui/` (shadcn base, restyled to the reference CSS and component docs):
   `Button` (variants primary/secondary/ghost/danger, press spring) and `BusyButton` (aria-busy sweep, no spinner),
   `Toggle` (spring thumb with press stretch), `Checkbox` (drawn tick + bounce), `Radio`, `SegmentedControl`,
   `StatusBadge` (tone + icon + label), `Field` (label, help, control, `SaveState` caption, error, locked variant),
   `Input`, `Textarea`, `Select`, `Table`, `Card`, `Dialog`, `DropdownMenu`, `Tooltip`, `Toast` (background results only).
   Icons from `lucide-react`, stroke 1.75, 18px nav/buttons, 16px inline.
6. Loading: `BlurLoad` (`state="loading|ready|stale"`, placeholder slot, `aria-busy`), `PlaceholderBar`, `ProgressRow`.
   Add an ESLint rule (no-restricted-imports / custom) that bans spinner components (`Loader2`, `Spinner`, `animate-spin`).
7. App shell for `/app/**`:
   - `Sidebar`: seal + "REC-DMS", role switcher slot (filled in M02), nav groups from a config per role view
     (see `docs/design/components/Sidebar.md`), collapse to rail with labels fading, active marker sliding via
     motion `layoutId`, user menu at the bottom. Collapsed state stored in a cookie.
   - Mobile (< 1024px): drawer from the left over `--scrim`, swipe/Escape to close, focus trapped.
   - `TopBar`: breadcrumb, notifications placeholder, `ThemeSwitch`.
   - `PageTransition`: content fade + 8px rise on route change (`dur-slow`); shell never animates.
   - Every route under `/app` gets a `loading.tsx` using `BlurLoad` with that page's placeholder layout.
8. Auth layout: centered column, seal 96px, `display` title "Research Ethics Committee", card `radius-lg`, on `bg`.
9. Reduced motion: global CSS from the reference; verify all components degrade to opacity fades.
10. `/dev/ui` route (dev only): a gallery of every primitive in every state, both themes side by side, used for review and
    Playwright visual snapshots.

## Acceptance criteria
- `/dev/ui` matches the design system's component previews (colors, sizes, motion) in light and dark.
- Switching theme never flashes; System follows the OS live.
- No spinner anywhere (lint rule passes; `grep -r animate-spin src` is empty).
- Lighthouse accessibility ≥ 95 on `/dev/ui`; every text pair ≥ 4.5:1 in both themes (add an automated check with axe).
- Keyboard: every control reachable, visible focus ring; sidebar drawer traps focus and returns it on close.
- Playwright visual snapshots of `/dev/ui` in both themes committed as baselines.

## Do not
- Introduce new colors, fonts or radii. Ask if a screen seems to need one.
- Build business screens here; only the shell and primitives.
