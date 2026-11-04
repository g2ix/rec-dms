# Blur loading

How every loading state looks: blurred content, never a spinner.

- **First load:** render the real layout with placeholder bars at real sizes, blurred with `blur-loading`. When data arrives, the real content replaces it and sharpens over `dur-reveal` (`ease-out-soft`). Nothing shifts.
- **Refresh** (filters, sorting, paging, revalidation): keep current content, blur it with `blur-stale` at 0.7 opacity, block clicks, clear when fresh data lands.
- **Next.js:** each route's `loading.tsx` renders that route's placeholder inside this wrapper; `useTransition` pending state switches lists to the stale state.
- Placeholder bars use `border` color, `radius` 3px, no shimmer.
- Announce loading to screen readers with `aria-busy="true"` on the region.
- Reduced motion: no blur transition, just swap.

Consumer provides: the placeholder layout, the content, and the state (`loading`, `ready`, `stale`).
