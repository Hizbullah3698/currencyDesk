// ---------------------------------------------------------------------------
// Activity signal — feeds the idle timeout (see useIdleTimeout.ts)
// ---------------------------------------------------------------------------
//
// A tiny module holding state and nothing else, so both the DOM listeners in the hook and the API
// layer in store.tsx/authClient.ts can report activity without either importing the other. Same
// shape as csrf.ts, and for the same reason: it avoids an import cycle between the store and the
// auth layer.
//
// Why API calls count as activity at all, when a request is not a person: a long report render, a
// slow save, or a background refetch all happen because someone asked for them. Counting only
// mouse and keyboard would start the countdown during the very operation the user is waiting on.

let lastActivityAt = Date.now()
const listeners = new Set<() => void>()

/** Records activity. Cheap enough to call from a mousemove handler. */
export function markActivity(): void {
  lastActivityAt = Date.now()
  for (const fn of listeners) fn()
}

export function lastActivity(): number {
  return lastActivityAt
}

/** Subscribe to activity. Returns an unsubscribe, for use in a React effect cleanup. */
export function onActivity(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// ---------------------------------------------------------------------------
// Server keepalive
// ---------------------------------------------------------------------------
// The server expires a session a fixed period after the LAST REQUEST (express-session's
// `rolling`). Mouse and keyboard activity produce no request, so a user reading a long report and
// moving the mouse for six minutes would keep the client timer alive while the server session
// quietly lapsed underneath them — and their next click would fail as unauthenticated despite the
// app showing no warning at all.
//
// So genuine local activity has to touch the server occasionally. Throttled hard, because the
// point is to keep the session warm, not to poll: at most one request per interval, and only when
// something actually happened.
const KEEPALIVE_INTERVAL_MS = 60_000
let lastServerContactAt = Date.now()

/** Called by the API layer whenever a real request goes out, so a keepalive is never sent
 *  redundantly alongside traffic the app was already making. */
export function markServerContact(): void {
  lastServerContactAt = Date.now()
}

export function needsKeepalive(now = Date.now()): boolean {
  return now - lastServerContactAt >= KEEPALIVE_INTERVAL_MS
}

export function resetActivity(): void {
  lastActivityAt = Date.now()
  lastServerContactAt = Date.now()
}
