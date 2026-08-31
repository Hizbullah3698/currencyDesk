import type { Role } from './types'
import { apiUrl } from './apiBase'

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
    return { ok: true, user: body.user }
  } catch {
    return { ok: false, error: 'Could not reach the server. Is the backend running?' }
  }
}

export async function logout(): Promise<void> {
  try {
    await fetch(apiUrl('/api/auth/logout'), { method: 'POST', credentials: 'include' })
  } catch {
    /* best-effort — local session state is cleared regardless by the caller */
  }
}

export type MeResult = { status: 'authenticated'; user: SessionUser } | { status: 'anonymous' } | { status: 'unreachable' }

export async function me(): Promise<MeResult> {
  try {
    const res = await fetch(apiUrl('/api/auth/me'), { credentials: 'include' })
    if (res.status === 401) return { status: 'anonymous' }
    if (!res.ok) return { status: 'unreachable' }
    const body = await parseJson(res)
    if (!body?.user) return { status: 'anonymous' }
    return { status: 'authenticated', user: body.user }
  } catch {
    return { status: 'unreachable' }
  }
}
