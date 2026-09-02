import type { Role } from './types'
import { apiUrl } from './apiBase'
import { clearCsrfToken, getCsrfToken, setCsrfToken, CSRF_HEADER } from './csrf'
import { markServerContact } from './activity'
import { notifySessionExpired } from './sessionExpiry'

export interface SessionUser {
  id: string
  email: string
  /** Null for accounts that have not been given a login username yet. */
  username: string | null
  displayName: string
  role: Role
}

async function parseJson(res: Response): Promise<any> {
  try {
    return await res.json()
  } catch {
    return null
  }
}

/** `identifier` is whatever the user typed — either their username or their email address. */
export async function login(identifier: string, password: string): Promise<{ ok: true; user: SessionUser } | { ok: false; error: string }> {
  try {
    const res = await fetch(apiUrl('/api/auth/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      // `email` is sent alongside `identifier` only so a newly deployed frontend still works
      // against a backend that hasn't picked up the `identifier` field yet — the two deploy
      // separately. The backend prefers `identifier` when both are present.
      body: JSON.stringify({ identifier, email: identifier, password }),
    })
    const body = await parseJson(res)
    if (!res.ok) return { ok: false, error: body?.error || 'Sign in failed.' }
    // The token belongs to the session that was just created, so it is captured here rather than
    // fetched separately — see csrf.ts for why it is held in memory only.
    setCsrfToken(body.csrfToken)
    return { ok: true, user: body.user }
  } catch {
    return { ok: false, error: 'Could not reach the server. Is the backend running?' }
  }
}

export async function logout(): Promise<void> {
  try {
    // Logout is a POST and is NOT exempt from CSRF checks server-side, so it has to carry the
    // token like any other mutating request. Missing this would mean sign-out breaks the moment
    // enforcement is switched on (stage 3) — while every other action kept working, which is a
    // particularly confusing failure to debug.
    const token = getCsrfToken()
    await fetch(apiUrl('/api/auth/logout'), {
      method: 'POST',
      credentials: 'include',
      headers: token ? { [CSRF_HEADER]: token } : undefined,
    })
  } catch {
    /* best-effort — local session state is cleared regardless by the caller */
  } finally {
    // Cleared whether or not the request succeeded: the token is meaningless once the caller has
    // dropped the session, and leaving a stale one behind would be sent on a later request.
    clearCsrfToken()
  }
}

export type MeResult = { status: 'authenticated'; user: SessionUser } | { status: 'anonymous' } | { status: 'unreachable' }

export async function me(): Promise<MeResult> {
  try {
    markServerContact()
    const res = await fetch(apiUrl('/api/auth/me'), { credentials: 'include' })
    if (res.status === 401) {
      clearCsrfToken()
      // Raised here as well as in the store, because this is the call the idle keepalive makes:
      // a user who is plainly present but making no other requests would otherwise sit in front
      // of a fully-rendered app whose session had already lapsed, and find out at their next
      // click. A no-op at boot and on a failed login, when no session was ever established.
      notifySessionExpired()
      return { status: 'anonymous' }
    }
    if (!res.ok) return { status: 'unreachable' }
    const body = await parseJson(res)
    if (!body?.user) {
      clearCsrfToken()
      notifySessionExpired()
      return { status: 'anonymous' }
    }
    // /me carries the token as well as /login. This is the call every returning user makes on
    // boot without re-authenticating, so it is the only way a session that predates the token
    // mechanism — or a page reload, which starts with empty memory — acquires one.
    setCsrfToken(body.csrfToken)
    return { status: 'authenticated', user: body.user }
  } catch {
    return { status: 'unreachable' }
  }
}

/**
 * Re-fetches the CSRF token for the current session, returning it (or null if the session is gone).
 *
 * This is the recovery path for a tab that holds a valid session cookie but no token in memory —
 * possible because the token is memory-only, so anything that resets module state without a fresh
 * boot (or a request racing ahead of AuthProvider's own /me) leaves the cookie valid and the token
 * absent. Rather than failing the user's action, the caller refreshes and retries once.
 */
export async function refreshCsrfToken(): Promise<string | null> {
  const result = await me()
  return result.status === 'authenticated' ? getCsrfToken() : null
}
