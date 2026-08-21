# Currency Desk

A currency-exchange desk front-end (presentation/demo build): trades, cheques, payments,
salary, ledgers, balance sheet/income statement, all backed by client-side state.

## Stack

- React 19 + TypeScript, Vite 8, React Router 7
- Tailwind CSS v4 (`@theme` tokens in `src/index.css`, no `tailwind.config`)
- Radix primitives + `class-variance-authority` for `src/components/ui/*`
- No backend: all data lives in `localStorage`, seeded from `src/lib/seed.ts`

## Color tokens & dark mode

All color is driven by CSS custom properties defined once in `src/index.css` under `@theme`,
then overridden in two dark blocks: a `@media (prefers-color-scheme: dark)` block (system
preference) and a `:root[data-theme="dark"]` block (explicit user choice always wins). Never
hardcode a hex color in a component — use the Tailwind utility for the token
(`bg-surface`, `text-ink`, `border-border-strong`, etc.) or `var(--color-*)` in inline styles.

**Solid-fill vs soft-tint is a real distinction, not a style choice:**
- Soft-tint (`bg-X-bg` + `text-X` or `text-X-text` + `border-X-border`) is used for badges,
  banners, and chips. Text and background are the same hue family, so contrast direction never
  flips between light/dark — no special handling needed beyond picking dark-mode-safe hues.
- Solid-fill (a colored background with white/light text on top, e.g. primary/destructive
  buttons) is the dangerous case: a hue that reads fine as *text on the page* in dark mode often
  fails 4.5:1 contrast for *white text on top of it*. This is why `--color-accent-solid` and
  `--color-negative-solid` exist as separate tokens from `--color-accent`/`--color-negative` —
  they're identical in light mode but diverge in dark mode.
- **`--color-positive` and `--color-pending` have no `-solid` variant on purpose** — as of this
  writing they are never used as solid fills anywhere in the app (only as tinted badges, chip
  icons, small status dots, or thin progress bars). If you ever add a solid positive/pending
  button, banner, or badge with light text, add `--color-positive-solid` /
  `--color-pending-solid` following the same pattern as `accent`/`negative` and verify contrast
  in dark mode before shipping — don't assume the plain token is safe for that use.
- Category tint colors (`--color-cat-*`) are for icon-badge backgrounds only, never card
  backgrounds or numeric values — the positive/negative/pending state colors are the only
  state signal in the app.

When adding any new state color, re-derive its dark-mode hue rather than mechanically darkening
the light one, and check it against both the dark page (`--color-app`) and dark card
(`--color-surface`) backgrounds, plus its own tinted background if it has one.

## Theming implementation

- `src/lib/theme.tsx` — `ThemeProvider`/`useTheme`, stores `'light' | 'dark' | 'system'` under
  its own `currencydesk.theme.v1` localStorage key, sets/removes `data-theme` on `<html>`.
- Deliberately a separate key from `currencydesk.state.v1` (the business-data store in
  `src/lib/store.tsx`) — a display preference isn't data worth protecting the way a posted
  trade or cheque is.
- `src/components/layout/ThemeToggle.tsx` — the three-way light/dark/system control in the
  TopBar.

## State & data

- `src/lib/store.tsx` holds all app state (accounts, activity, cheques, journal entries,
  stocks) behind a `StoreCtx`, persisted to `localStorage` under `currencydesk.state.v1`.
- A `pristine` flag distinguishes untouched seed data from real user actions — it's cleared by
  `mutate()` the moment any real action happens (trade, payment, cheque action, journal entry,
  salary run, account CRUD). It gates a date-staleness auto-reseed (this is a demo build, so
  seed dates are relative to "now") and must never cause real entered data to be discarded. If
  you add a new mutating action, make sure it clears `pristine` the same way.
- Auth/role state does not persist across a full page reload by design (demo build) — logging
  in again after a navigate/reload is expected, not a bug.

## Verifying UI changes

This project has no test suite tied to visual/contrast changes — verify color and dark-mode
work by actually running the app (`npm run dev`) and taking screenshots in both themes, not by
reasoning about hex values alone. When asked to confirm dark-mode or contrast fixes are done,
provide actual screenshots, not descriptions of what should be true.
