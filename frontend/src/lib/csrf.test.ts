import { describe, it, expect, beforeEach } from 'vitest'
import { CSRF_HEADER, clearCsrfToken, getCsrfToken, isCsrfError, isMutatingMethod, requestHeaders, setCsrfToken } from './csrf'

// Client half of the CSRF rollout. What is tested here is the decision logic — when a token is
// attached, and when a failure is worth retrying — because those are the two places a mistake is
// silent rather than loud:
//   * failing to attach on some method means stage 3 rejects that action and nothing else,
//   * retrying too broadly hides a genuine authorization failure behind a pointless second try.
describe('csrf token holder', () => {
  beforeEach(() => clearCsrfToken())

  it('stores and returns a token', () => {
    setCsrfToken('a'.repeat(64))
    expect(getCsrfToken()).toBe('a'.repeat(64))
  })

  it('treats an absent, empty or non-string value as no token rather than storing junk', () => {
    setCsrfToken('abc')
    setCsrfToken('')
    expect(getCsrfToken()).toBeNull()

    setCsrfToken('abc')
    setCsrfToken(undefined)
    expect(getCsrfToken()).toBeNull()

    setCsrfToken('abc')
    setCsrfToken(null)
    expect(getCsrfToken()).toBeNull()
  })

  it('clears', () => {
    setCsrfToken('abc')
    clearCsrfToken()
    expect(getCsrfToken()).toBeNull()
  })
})

describe('which methods need a token', () => {
  it('treats GET, HEAD and OPTIONS as safe, case-insensitively', () => {
    for (const m of ['GET', 'HEAD', 'OPTIONS', 'get', 'head', 'options']) {
      expect(isMutatingMethod(m), `${m} should be safe`).toBe(false)
    }
  })

  it('treats every mutating verb the app uses as needing a token', () => {
    // POST, PATCH and DELETE are all in use across the API surface. Missing any one of them would
    // break exactly that group of actions at stage 3 — e.g. dropping DELETE would leave account
    // deletion broken while everything else worked.
    for (const m of ['POST', 'PATCH', 'DELETE', 'PUT', 'post', 'patch', 'delete']) {
      expect(isMutatingMethod(m), `${m} should require a token`).toBe(true)
    }
  })
})

describe('requestHeaders', () => {
  beforeEach(() => clearCsrfToken())

  it('always sets the JSON content type', () => {
    expect(requestHeaders('GET')['Content-Type']).toBe('application/json')
    expect(requestHeaders('POST')['Content-Type']).toBe('application/json')
  })

  it('attaches the token on a mutating request when one is held', () => {
    setCsrfToken('t0ken')
    expect(requestHeaders('POST')[CSRF_HEADER]).toBe('t0ken')
    expect(requestHeaders('PATCH')[CSRF_HEADER]).toBe('t0ken')
    expect(requestHeaders('DELETE')[CSRF_HEADER]).toBe('t0ken')
  })

  it('does not attach it on a safe request', () => {
    setCsrfToken('t0ken')
    expect(requestHeaders('GET')[CSRF_HEADER]).toBeUndefined()
  })

  it('omits the header entirely when no token is held, rather than sending an empty one', () => {
    // An empty or literal "null" header would be a PRESENT-but-wrong token, which the server
    // rejects outright even at stage 1. Absent is the correct representation of "don't have one".
    const headers = requestHeaders('POST')
    expect(CSRF_HEADER in headers).toBe(false)
  })
})

describe('isCsrfError — what is worth retrying', () => {
  it('matches on the response body code, whichever CSRF 403 it was', () => {
    expect(isCsrfError(403, { error: 'Missing security token. Reload the page and try again.', code: 'CSRF_TOKEN' })).toBe(true)
    expect(isCsrfError(403, { error: 'Invalid security token. Reload the page and try again.', code: 'CSRF_TOKEN' })).toBe(true)
  })

  it('falls back to the message for a backend that does not send code yet (one deploy cycle)', () => {
    expect(isCsrfError(403, { error: 'Missing security token. Reload the page and try again.' })).toBe(true)
    expect(isCsrfError(403, 'Invalid security token. Reload the page and try again.')).toBe(true)
  })

  it('does NOT match a genuine authorization failure', () => {
    // The load-bearing case. Both are 403. Retrying this one would waste a round trip and, worse,
    // could leave the user staring at a generic failure instead of "Admin access required".
    expect(isCsrfError(403, { error: 'Admin access required.' })).toBe(false)
    expect(isCsrfError(403, 'Not authenticated.')).toBe(false)
    expect(isCsrfError(403, { error: 'Admin access required.', code: 'FORBIDDEN' })).toBe(false)
  })

  it('does not match non-403 responses even if the text or code says CSRF', () => {
    expect(isCsrfError(400, 'Invalid security token.')).toBe(false)
    expect(isCsrfError(500, { error: 'x', code: 'CSRF_TOKEN' })).toBe(false)
  })

  it('handles a missing or non-string body without throwing', () => {
    // A bare 502 from the dev proxy has no body at all.
    expect(isCsrfError(403, undefined)).toBe(false)
    expect(isCsrfError(403, null)).toBe(false)
    expect(isCsrfError(502, undefined)).toBe(false)
  })
})
