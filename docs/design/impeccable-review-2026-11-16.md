# Impeccable review: 16 Nov 2026

⚠️ DEGRADED: single-context (no sub-agents run; the Impeccable detector engine was not downloaded, so there is no deterministic scan).

- Tool: Impeccable 4.9.2 (pbakaus/impeccable, Apache-2.0). The skill is at `.claude/skills/impeccable/`.
- Method: critique and audit playbooks, applied by hand.
- What was looked at:
  - source code: `docs/design/BRAND.md`, `src/styles/*`, `src/components/shell/nav.ts`, protocol tabs
  - rendered screens: `/dev/ui` in both themes, and the TOTP gate on desktop and on a 375px phone
- Not looked at: every signed-in route sits behind the TOTP gate, so dashboards, the intake wizard and the review screens were reviewed from source only.

## Verdict

**The design system is strong and specific to this product.** Impeccable would push it a little further, but it would not replace it. `BRAND.md` already covers most of what Impeccable checks:

- a single action colour
- no spinners
- a reduced-motion plan
- a 2px focus ring
- a ban list for the usual machine-made patterns

The problems are in information architecture and a few unfinished spots, not in the visual language.

## Audit scores

| # | Dimension | Score | Key finding |
|---|---|---|---|
| 1 | Accessibility | 3 | A keyboard-highlighted menu item differs from its menu by a 1.11:1 fill only |
| 2 | Performance | 3 | No spinners; blur loading as specified. Nothing measured |
| 3 | Theming | 4 | Full light and dark tokens; 16 hex values outside the tokens, mostly the sign-in page and the Google mark |
| 4 | Responsive | 3 | No horizontal scroll at 375px; protocol tabs scroll sideways |
| 5 | Implementation integrity | 3 | Placeholder pages are still in the navigation |
| **Total** | | **16/20** | **Good** |

Contrast was checked for these token pairs, light and dark:

- `ink-muted` on `surface-sunken`: 6.2 light, 7.6 dark
- `warning` on `warning-soft`: 5.4 light, 10.1 dark
- `primary` on `bg`: 5.2 light
- `border-control` on `surface`: 3.4 light, 3.7 dark

All of them pass AA.

## Priority issues

1. **[P1] The REC Chair sees two "Settings" items, and one is a placeholder.**
   - Where: `src/components/shell/nav.ts:73`
   - What happens: `chairItems` repeats every staff item, including `/admin/settings`, then adds `/app/settings`. Both use the same icon. The second one lands on the catch-all placeholder ("Committee settings will be edited here.").
   - Fix: remove the second item, or rename it to say what it actually holds.
2. **[P1] The Staff and Chair sidebars have 18 items in one ungrouped list.**
   - What happens: daily work (Screening queue, Fee receipts, Releases) sits at the same level as configuration that changes rarely (Workflows, Forms, Retention, Holidays). Two icons are also reused, which defeats scanning in the collapsed rail: CalendarDays for Meetings and Holidays, Receipt for Fee receipts and Fees.
   - Fix: split the list into groups, such as Work, Records and Administration. `NavGroup.label` already supports this. Give every item its own icon. Suggested command: `/impeccable layout` or `/impeccable distill`.
3. **[P2] Keyboard focus in dropdown menus is nearly invisible.**
   - Where: `components.css:594`
   - What happens: `.rec-menu__item` sets `outline: none`, so `data-highlighted` shows only a `surface-sunken` fill on `surface-raised`. That is 1.11:1 in light and 1.25:1 in dark. This breaks the BRAND rule "every focusable element gets a 2px focus ring".
   - Fix: add an inset `focus` ring, or a stronger fill, on `[data-highlighted]`. Suggested command: `/impeccable audit`, then `/impeccable polish`.
4. **[P2] The TOTP gate's copy and role label don't match each other.**
   - What happens: the card lists six roles that need a code, then says "Signed in as … · Proponent". A user reads that as "I'm a Proponent, so why am I being asked?"
   - Fix: name the role that triggered the gate ("Your REC Staff role needs this each sign-in") instead of listing all six. Suggested command: `/impeccable clarify`.
5. **[P3] The reduced-motion fade for the TOTP card never runs.**
   - What happens: the global reduce rule at `components.css:1797` sets `animation: none !important`, which overrides the 120ms fade defined at line 2796. The card appears instantly instead of fading as BRAND specifies.
   - Fix: scope the global rule more narrowly, or add `!important` to the TOTP rule.

## What's working

- The tokens and their contrast, and dark mode that is designed in its own right rather than inverted.
- Focus: nearly every `outline: none` is paired with a `:focus-visible` or `:focus-within` ring on a wrapper.
- The serif titles that echo the printed REC forms. That choice is specific to this product.
- The copy rules in BRAND.md, which are better than the defaults Impeccable would supply.

## Should Impeccable stay?

Use it as an occasional reviewer, not as the design authority.

- **Run `/impeccable document` once.** It generates a DESIGN.md. Then point that file at `docs/design/BRAND.md` and `tokens.json`, so later runs read your system instead of inventing one.
- **Use `critique`, `audit`, `clarify` and `polish` before a release.**
- **Avoid `bolder`, `overdrive`, `delight` and `colorize`.** They pull against BRAND's "calm, exact, never flashy".
- **To get the full method,** allow its engine binary for the deterministic detector, and sign in as a seeded staff account with a test TOTP.
