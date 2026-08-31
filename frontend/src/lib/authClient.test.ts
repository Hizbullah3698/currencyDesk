import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { refreshCsrfToken, logout, login } from './authClient'
import { clearCsrfToken, getCsrfToken, setCsrfToken, CSRF_HEADER } from './csrf'

// The recovery path is the piece of stage 2 most likely to be subtly wrong, because it only runs
// in a state that is hard to reach by hand: a tab holding a valid session cookie but no token in
// memory. If it fails, the symptom is a user action refused for no visible reason — so it is
// tested directly rather than trusted.

const TOKEN = 'b'.repeat(64)

function mockFetch(impl: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const spy = vi.fn((input: any, init?: RequestInit) => Promise.resolve(impl(String(input), init)))
  vi.stubGlobal('fetch', spy)
  return spy
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('refreshCsrfToken — the recovery path', () => {
  beforeEach(() => clearCsrfToken())
  afterEach(() => vi.unstubAllGlobals())

  it('fetches a token for a session that has a cookie but no token in memory', () => {
    mockFetch(() => json(200, { user: { id: 'u1', role: 'admin' }, csrfToken: TOKEN }))
    expect(getCsrfToken()).toBeNull()

    return refreshCsrfToken().then((token) => {
      expect(token).toBe(TOKEN)
      expect(getCsrfToken()).toBe(TOKEN)
    })
  })

  it('returns null and holds no token when the session is actually gone', async () => {
    // A 401 here means the cookie is dead, not that the token is missing. Returning null tells the
    // caller not to retry — retrying would loop against an endpoint that will keep saying 401.
    setCsrfToken('stale-token')
    mockFetch(() => json(401, { error: 'Not authenticated.' }))

    expect(await refreshCsrfToken()).toBeNull()
    expect(getCsrfToken()).toBeNull()
  })

  it('does not leave a stale token behind when the server stops returning one', async () => {
    setCsrfToken('stale-token')
    mockFetch(() => json(200, { user: { id: 'u1', role: 'admin' } })) // no csrfToken field

    const token = await refreshCsrfToken()
    expect(token).toBeNull()
    expect(getCsrfToken()).toBeNull()
  })

  it('returns null rather than throwing when the server is unreachable', async () => {
    setCsrfToken('some-token')
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network down'))))
    expect(await refreshCsrfToken()).toBeNull()
  })
})

describe('login captures the token', () => {
  beforeEach(() => clearCsrfToken())
  afterEach(() => vi.unstubAllGlobals())

  it('stores the token returned by a successful sign-in', async () => {
    mockFetch(() => json(200, { user: { id: 'u1', role: 'admin' }, csrfToken: TOKEN }))
    const result = await login('admin', 'pw')
    expect(result.ok).toBe(true)
    expect(getCsrfToken()).toBe(TOKEN)
  })

  it('holds no token after a failed sign-in', async () => {
    mockFetch(() => json(401, { error: 'Invalid username or password.' }))
    const result = await login('admin', 'wrong')
    expect(result.ok).toBe(false)
    expect(getCsrfToken()).toBeNull()
  })
})

describe('logout', () => {
  beforeEach(() => clearCsrfToken())
  afterEach(() => vi.unstubAllGlobals())

  it('sends the token, because logout is NOT exempt from the server-side check', async () => {
    // Missing this would mean sign-out is the one action that breaks at stage 3, while everything
    // else keeps working — a confusing failure to diagnose.
    setCsrfToken(TOKEN)
    const spy = mockFetch(() => new Response(null, { status: 204 }))

    await logout()

    const init = spy.mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>)[CSRF_HEADER]).toBe(TOKEN)
  })

  it('clears the token even when the request fails', async () => {
    setCsrfToken(TOKEN)
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network down'))))

    await logout()

    // The caller drops the session regardless, so keeping the token would mean sending a stale
    // one on some later request.
    expect(getCsrfToken()).toBeNull()
  })
})
