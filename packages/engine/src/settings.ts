// ---------------------------------------------------------------------------
// Runtime-editable settings — the numbers both tiers must agree on
// ---------------------------------------------------------------------------
//
// The idle timeout is stored in the database (migration 015) and edited from the admin Settings
// page, but its DEFAULT, its BOUNDS, and how long the server caches it are constants both the
// backend and the frontend need to know: the backend to serve and clamp them, the frontend to
// fall back to them when `/api/settings` cannot be reached (a deliberate fail-closed — see
// lib/settings.ts) and to say, on the Settings page, how long a change takes to propagate.
//
// They lived in two places — backend `settingsService.ts` and frontend `lib/settings.ts` — and
// drifted risk was real: raise the server's maximum and the frontend fallback would keep
// asserting the old one. Here once, imported by both.

/** The idle timeout used when the `idle_timeout_minutes` row is absent or unparseable. A missing
 *  row must degrade to a real timeout, never to "no timeout", which would fail open. */
export const DEFAULT_IDLE_TIMEOUT_MINUTES = 5

/**
 * Bounds, enforced on write by the backend.
 *
 * The lower bound is not arbitrary: the warning modal appears `IDLE_WARNING_SECONDS` before
 * expiry, so anything under a minute would show a countdown that begins before the user has
 * finished the action that started it. The upper bound keeps this recognisably an *idle*
 * timeout — beyond a working day it stops being a security control and starts being a slow
 * memory leak of live sessions.
 */
export const MIN_IDLE_TIMEOUT_MINUTES = 1
export const MAX_IDLE_TIMEOUT_MINUTES = 480

/**
 * How long the backend caches the idle-timeout value per process. Consulted on every
 * authenticated request, so a database round trip per request to Neon would be a real cost for a
 * value that changes perhaps twice a year. The trade is propagation delay after an admin edits
 * it, which the Settings page states using this number.
 */
export const SETTINGS_CACHE_TTL_SECONDS = 30

/** How long before an idle sign-out the warning modal appears and starts counting down. */
export const IDLE_WARNING_SECONDS = 30
