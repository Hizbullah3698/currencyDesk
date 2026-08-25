import type { Role } from './types'
import { apiUrl } from './apiBase'

export interface SessionUser {
  id: string
  email: string
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

export async function login(email: string, password: string): Promise<{ ok: true; user: SessionUser } | { ok: false; error: string }> {
  try {
    const res = await fetch(apiUrl('/api/auth/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password }),
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
