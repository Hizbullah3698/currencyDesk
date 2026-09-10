// ---------------------------------------------------------------------------
// CSRF token — client half of the protection described in backend/src/middleware/csrf.ts
// ---------------------------------------------------------------------------
//
// The token is held in MEMORY ONLY, deliberately. It is not in localStorage and not in a cookie:
//   - A cookie the page can read is what double-submit CSRF needs, and across this app's two
//     origins that means a readable cross-site cookie — the exact awkwardness this design avoids.
//   - localStorage would persist it beyond the session it belongs to, and survive a sign-out in
//     another tab.
// Memory-only means a page reload starts with no token, which is fine: AuthProvider calls
// GET /api/auth/me on every boot and that response carries one.
//
// This module holds state and nothing else — no imports — so both authClient.ts (which sets it)
// and store.tsx (which reads it) can use it without an import cycle.

let token: string | null = null

export function setCsrfToken(value: string | null | undefined): void {
  token = typeof value === 'string' && value.length > 0 ? value : null
}

export function getCsrfToken(): string | null {
  return token
}

export function clearCsrfToken(): void {
  token = null
}

/** Methods that never mutate, and so never need a token. Mirrors the server's own list. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export function isMutatingMethod(method: string): boolean {
  return !SAFE_METHODS.has(method.toUpperCase())
}

export const CSRF_HEADER = 'X-CSRF-Token'

/**
 * Headers for a request, adding the CSRF token only when it is both needed and available.
 *
 * Sending it on a safe method would be harmless but pointless; omitting it when absent is
 * deliberate rather than an error, because during rollout stage 2 the server still accepts
 * requests without one. Once the server enforces (stage 3) a missing token is recoverable —
 * see `withCsrfRetry` in store.tsx.
 */
export function requestHeaders(method: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const value = getCsrfToken()
  if (isMutatingMethod(method) && value) headers[CSRF_HEADER] = value
  return headers
}

/** The `code` the backend puts on both CSRF 403 responses (middleware/csrf.ts CSRF_ERROR_CODE). */
const CSRF_ERROR_CODE = 'CSRF_TOKEN'

/**
 * Whether a failed response is a CSRF rejection specifically, as opposed to an ordinary
 * authorization failure.
 *
 * This distinction matters: both come back as 403. Retrying a genuine "Admin access required"
 * would be pointless and would mask the real reason from the user, so only a token problem is
 * worth refreshing and retrying.
 *
 * Matches on the response body's `code` first. Falls back to a regex on the human message for the
 * one deploy cycle where a new frontend may be talking to a backend that does not send `code`
 * yet — the two tiers deploy separately.
 */
export function isCsrfError(status: number, body?: { error?: string; code?: string } | string | null): boolean {
  if (status !== 403) return false
  if (body && typeof body === 'object' && body.code === CSRF_ERROR_CODE) return true
  const message = typeof body === 'string' ? body : body?.error
  return typeof message === 'string' && /security token/i.test(message)
}
