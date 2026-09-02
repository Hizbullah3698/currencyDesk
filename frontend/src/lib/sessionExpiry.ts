// ---------------------------------------------------------------------------
// Session-expiry signal
// ---------------------------------------------------------------------------
//
// One place for "the server just told us this session is gone", so that a 401 anywhere ends up at
// the login screen instead of wherever that particular caller happened to display its errors.
//
// The bug this exists to close: AuthProvider resolved identity once, at boot, and never revisited
// it. A session expiring mid-use (the idle window lapsing, or another tab signing out) left the
// app still believing it was authenticated, so the next GET /api/state came back 401 and the store
// recorded it as an ordinary load failure — "Couldn't load your data: Not authenticated.", with a
// Retry button that reissued the same unauthenticated request and could only ever fail the same
// way. The only escape was a new tab, because a new tab re-runs /api/auth/me.
//
// This module holds state and nothing else — no imports — so the API layers (store.tsx,
// authClient.ts, settings.ts) can raise the signal and auth.tsx can subscribe to it, with no
// import cycle. Same shape and the same reason as csrf.ts and activity.ts.
//
// `active` is the whole reason this is not simply "any 401 means expired". Two 401s are perfectly
// normal and must NOT be reported as an expiry:
//   - GET /api/auth/me at boot, for someone who is not signed in.
//   - POST /api/auth/login with the wrong password.
// Both happen while there is no established session, so `active` is false and the signal is a
// no-op. It only becomes true once AuthProvider has actually resolved an authenticated session,
// which is exactly the window in which a 401 means "it ended underneath us".

let active = false
const listeners = new Set<() => void>()

/** Called by AuthProvider as identity resolves: true once authenticated, false once not. */
export function setSessionActive(value: boolean): void {
  active = value
}

export function isSessionActive(): boolean {
  return active
}

/**
 * Report a 401 from an authenticated request.
 *
 * A no-op unless a session was actually established (see above), and self-disarming: the first
 * 401 flips `active` off, so a burst of concurrent requests all failing at once notifies exactly
 * once rather than re-entering sign-out for each.
 */
export function notifySessionExpired(): void {
  if (!active) return
  active = false
  for (const fn of listeners) fn()
}

/** Subscribe. Returns an unsubscribe, for use in a React effect cleanup. */
export function onSessionExpired(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
